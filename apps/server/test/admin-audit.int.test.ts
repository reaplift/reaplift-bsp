import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetaClient } from '../src/lib/meta-client.js';
import { watchCampaigns, STALLED_AFTER_MS } from '../src/modules/campaigns/monitor.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { AccountPacer, sendDue } from '../src/modules/messaging/sender.js';
import { readSendStats } from '../src/modules/messaging/stats.js';
import { checkLedgers, readBalance } from '../src/modules/wallet/ledger.js';
import { refreshDailyStats } from '../src/modules/reports/stats.js';
import { FakeMeta, HELLO_WORLD, metaError, statusWebhook } from './support/fake-meta.js';
import { createWorld, PANEL } from './support/world.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const CLOCK = new Date('2026-11-02T10:00:00Z');
const FUTURE = new Date('2026-11-03T00:00:00Z');
const PRICE = 95;
const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-audit-'));
const fake = new FakeMeta();
let w: Awaited<ReturnType<typeof createWorld>>;
let app: ReturnType<Awaited<ReturnType<typeof createWorld>>['makeApp']>;
let meta: MetaClient;
let templateId = '';
const cookies: Record<string, string> = {};

const call = (email: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: cookies[email]!, origin: PANEL }, ...(payload ? { payload } : {}) });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const base = () => `/api/clients/${w.ids.northwind}`;
const send = (now = FUTURE) => sendDue({ db: w.db, meta, encryptionKey: KEY, pacer: new AccountPacer() }, now);
const store = (body: string) => sql`insert into meta_events (body) values (${body}::jsonb)`.execute(w.db);
let nextNumber = 9000000000;
const campaign = async (count: number) => {
  const csv = ['Name,Mobile', ...Array.from({ length: count }, () => `A,${nextNumber++}`)].join('\n');
  const list = await app.inject({
    method: 'POST',
    url: `${base()}/lists?fileName=a.csv&optIn=true`,
    headers: { cookie: cookies[ASHA]!, origin: PANEL, 'content-type': 'text/csv' },
    payload: csv,
  });
  await call(ASHA, 'PUT', `${base()}/lists/${list.json().id}/number-column`, { column: 1 });
  const made = await call(ASHA, 'POST', `${base()}/campaigns`, { name: 'c', templateId, listId: list.json().id, variableMap: {} });
  return made.json().id as string;
};
const running = async (count: number) => {
  const id = await campaign(count);
  expect((await call(ASHA, 'POST', `${base()}/campaigns/${id}/confirm`)).statusCode).toBe(200);
  return id;
};
const view = async (id: string) => (await call(ASHA, 'GET', `${base()}/campaigns/${id}`)).json();
const wamids = async (id: string) =>
  (await rows(`select meta_message_id as w from messages where campaign_id = $1 and meta_message_id is not null order by id`, [id])).map((r) => r.w as string);

/** Every counter on one campaign, from the routes, against a count of its rows and its ledger rows. */
const expectCountersAgree = async (id: string) => {
  const shown = await view(id);
  const counts = Object.fromEntries((await rows('select status, count(*)::int as n from messages where campaign_id = $1 group by 1', [id])).map((r) => [r.status, r.n]));
  for (const bucket of ['sent', 'delivered', 'read', 'failed', 'blocked']) expect(shown[bucket], bucket).toBe(counts[bucket] ?? 0);
  expect(shown.total).toBe(Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0));
  const [{ charged, refunded }] = await rows(
    `select coalesce(-sum(amount_paise) filter (where kind = 'charge'), 0)::bigint as charged,
            coalesce(sum(amount_paise) filter (where kind = 'refund'), 0)::bigint as refunded
     from wallet_ledger where campaign_id = $1`,
    [id],
  );
  expect([shown.chargedPaise, shown.refundedPaise]).toEqual([charged, refunded]);
};

beforeAll(async () => {
  w = await createWorld();
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 500 });
  app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir });
  for (const email of [ADMIN, ASHA, MEERA]) cookies[email] = (await w.login(email)).cookie;
  fake.templates = [{ ...HELLO_WORLD, id: 'promo', name: 'promo', category: 'MARKETING', components: [{ type: 'BODY', text: 'Sale today, friends.' }] }];
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' });
  templateId = (await rows(`select id from templates where name = 'promo'`))[0].id;
  await call(ADMIN, 'POST', '/api/admin/meta-rates', { category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 7600, validFrom: '2026-01-01T00:00:00Z' });
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: 10000000 });
  await w.pool.query(`update wa_accounts set send_rate_per_sec = 500`);
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('every counter moves together, through one campaign’s whole life', () => {
  it('agrees at each step: sent, delivered, read, failed before and after sending, blocked and cancelled', async () => {
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: [String(nextNumber + 7)] });
    const id = await running(8);
    await expectCountersAgree(id);
    expect((await view(id))).toMatchObject({ total: 8, blocked: 1, chargedPaise: 8 * PRICE });

    await w.pool.query(`update wa_accounts set send_rate_per_sec = 5`);
    fake.queueSendResponses(metaError(400, 131026, 'Undeliverable'));
    await send();
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 500`);
    await expectCountersAgree(id);

    const [a, b, c] = await wamids(id);
    const at = 1_800_000_000;
    await store(statusWebhook(a!, 'delivered', at, { pricing: { category: 'marketing', type: 'regular', billable: true } }));
    await store(statusWebhook(b!, 'delivered', at, { pricing: { category: 'marketing', type: 'regular', billable: true } }));
    await store(statusWebhook(b!, 'read', at + 1));
    await store(statusWebhook(c!, 'failed', at, { errors: [{ code: 131049, title: 'Meta limit' }] }));
    await processEvents(w.db, CLOCK);
    await expectCountersAgree(id);

    await call(ASHA, 'POST', `${base()}/campaigns/${id}/cancel`);
    await expectCountersAgree(id);
    const shown = await view(id);
    expect(shown).toMatchObject({ status: 'cancelled', total: 8, sent: 1, delivered: 1, read: 1, failed: 2 });
    // Sent, delivered and read stay charged; so does the number blocked at confirm. The rest come back.
    expect(shown.chargedPaise - shown.refundedPaise).toBe(4 * PRICE);
    expect(shown.refundedPaise).toBe(4 * PRICE);
    expect(await checkLedgers(w.db)).toEqual([]);
  });

  it('the wallet, the ledger, the admin client list and detail all show the same money', async () => {
    const balance = await readBalance(w.db, w.ids.northwind);
    expect((await call(ASHA, 'GET', `${base()}/wallet`)).json().balancePaise).toBe(balance);
    expect((await call(ADMIN, 'GET', `/api/admin/clients/${w.ids.northwind}`)).json().balancePaise).toBe(balance);
    const listed = (await call(ADMIN, 'GET', '/api/admin/clients')).json().items.find((c: { id: string }) => c.id === w.ids.northwind);
    expect(listed).toMatchObject({ balancePaise: balance, onHoldPaise: 0 });
    const [{ total }] = await rows('select sum(amount_paise)::bigint as total from wallet_ledger where client_id = $1', [w.ids.northwind]);
    expect(balance).toBe(total);
    const top = (await call(ASHA, 'GET', `${base()}/wallet/ledger?limit=1`)).json().items[0];
    expect(top.balanceAfterPaise).toBe(balance);
  });

  it('the dashboard, month report and super admin view agree with the rows', async () => {
    await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
    await w.pool.query(`update wallet_ledger set created_at = $1`, [CLOCK]);
    await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');
    await w.pool.query(`update messages set queued_at = $1`, [CLOCK]);
    await w.pool.query(`update campaigns set confirmed_at = $1 where confirmed_at is not null`, [CLOCK]);
    await refreshDailyStats(w.db, CLOCK);

    const [{ messages, kept }] = await rows(
      `select count(*)::int as messages, coalesce(sum(client_price_paise) filter (
         where block_reason is distinct from 'campaign_cancelled'
           and not exists (select 1 from wallet_ledger r where r.kind = 'refund' and r.message_id = messages.id)
       ), 0)::bigint as kept from messages where client_id = $1`,
      [w.ids.northwind],
    );
    const tiles = (await call(ASHA, 'GET', `${base()}/dashboard`)).json().tiles;
    expect(tiles.thisMonth).toEqual({ messages, spendPaise: kept });

    const report = (await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-11`)).json().items;
    expect(report.reduce((sum: number, r: { 'Total Count': number }) => sum + r['Total Count'], 0)).toBe(messages);
    const units = report.reduce((sum: number, r: { 'Total Unit': string }) => sum + Math.round(Number(r['Total Unit']) * 100), 0);
    expect(units).toBe(kept);

    const northwind = (await call(ADMIN, 'GET', '/api/admin/meta-view?month=2026-11')).json().clients.find((c: { clientId: string }) => c.clientId === w.ids.northwind);
    expect(northwind.billedPaise).toBe(kept);
  });

  it('the limits used match who was messaged', async () => {
    const [{ unique }] = await rows(`select count(distinct to_number)::int as unique from messages where status in ('sent', 'delivered', 'read') and sent_at >= $1`, [new Date(CLOCK.getTime() - 86400000)]);
    const usage = (await call(ADMIN, 'GET', '/api/admin/limits-usage')).json();
    expect(usage.items[0].usedLast24Hours).toBe(unique);
    expect(usage.overall.usedLast24Hours).toBe(unique);
  });

  it('the nightly check catches a total that drifts from the rows', async () => {
    const id = await running(1);
    expect(await checkLedgers(w.db)).toEqual([]);
    await w.pool.query('update campaigns set sent = sent + 1 where id = $1', [id]);
    expect(await checkLedgers(w.db)).toEqual([id]);
    await w.pool.query('update campaigns set sent = sent - 1 where id = $1', [id]);
  });
});

describe('every setting takes effect through its route', () => {
  it('the promotional word list changes what a template submit refuses', async () => {
    const account = (await rows('select id from wa_accounts'))[0].id;
    const draft = await call(ASHA, 'POST', `${base()}/templates`, {
      waAccountId: account,
      name: 'mega_news',
      language: 'en_US',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Our megadeal is on for you today.' }],
    });
    const id = draft.json().id;
    expect((await call(ASHA, 'POST', `${base()}/templates/${id}/submit`)).statusCode).toBe(202);
    await w.pool.query(`update templates set status = 'DRAFT' where id = $1`, [id]);

    const before = (await call(ADMIN, 'GET', '/api/admin/settings/promo_words')).json().value;
    await call(ADMIN, 'PUT', '/api/admin/settings/promo_words', { value: [...before, 'megadeal'] });
    expect((await call(ASHA, 'POST', `${base()}/templates/${id}/submit`)).statusCode).toBe(422);
    await call(ADMIN, 'PUT', '/api/admin/settings/promo_words', { value: before });
  });

  it('a charging switch that cannot take effect is refused, not silently saved', async () => {
    const res = await call(ADMIN, 'PUT', '/api/admin/charge-policy', { outcome: 'sent_not_delivered', charged: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NOT_SUPPORTED');
    expect((await call(ADMIN, 'GET', '/api/admin/charge-policy')).json().policy.sent_not_delivered).toBe(true);
    expect((await call(ADMIN, 'PUT', '/api/admin/charge-policy', { outcome: 'sent_not_delivered', charged: true })).statusCode).toBe(200);
  });

  it('every change to a setting is audited', async () => {
    const count = async () => (await rows('select count(*)::int as n from audit_logs'))[0].n as number;
    const account = (await rows('select id from wa_accounts'))[0].id;
    const changes: Array<[string, string, object]> = [
      ['POST', '/api/admin/meta-rates', { category: 'UTILITY', countryCallingCode: '91', rateCentipaise: 1150, validFrom: '2026-01-01T00:00:00Z' }],
      ['PUT', '/api/admin/pricing', { markupBp: { marketing: 2500, utility: 2500, authentication: 2500 } }],
      ['PUT', `/api/admin/clients/${w.ids.greenleaf}/pricing`, { mode: 'default' }],
      ['PUT', '/api/admin/charge-policy', { outcome: 'blocked', charged: true }],
      ['PATCH', `/api/admin/clients/${w.ids.greenleaf}/low-balance-alert`, { alertPaise: 100 }],
      ['PUT', '/api/admin/rules', { type: 'marketing_cap', values: { count: 99, period: 'week' }, enabled: false }],
      ['PUT', '/api/admin/settings/stop_words', { value: ['STOP', 'UNSUBSCRIBE'] }],
      ['PUT', '/api/admin/credit-limit', { limitPaise: 100000000 }],
      ['PATCH', `/api/admin/wa-accounts/${account}/limits`, { sendRatePerSec: 500 }],
      ['PATCH', `/api/admin/clients/${w.ids.greenleaf}`, { contactEmail: 'new@greenleaf.in' }],
    ];
    for (const [method, url, body] of changes) {
      const before = await count();
      const res = await call(ADMIN, method as 'PUT', url, body);
      expect(res.statusCode, url).toBeLessThan(300);
      expect(await count(), url).toBe(before + 1);
    }
  });

  it('only a super admin reads any of it', async () => {
    const urls = ['users', 'clients', 'audit', 'notifications', 'rules', 'meta-rates', 'pricing', 'charge-policy', 'meta-view', 'meta-invoices', 'limits-usage', 'settings/promo_words', `clients/${w.ids.northwind}/opt-outs`];
    for (const url of urls) {
      expect((await call(ADMIN, 'GET', `/api/admin/${url}`)).statusCode, url).toBe(200);
      expect((await call(ASHA, 'GET', `/api/admin/${url}`)).statusCode, url).toBe(403);
      expect((await call(MEERA, 'GET', `/api/admin/${url}`)).statusCode, url).toBe(403);
    }
  });
});

describe('why is my campaign not moving?', () => {
  const why = async (id: string) => (await call(ADMIN, 'GET', `/api/admin/campaigns/${id}/diagnosis`)).json();
  const codes = async (id: string) => (await why(id)).reasons.map((r: { code: string }) => r.code);
  const stopAll = async () => {
    for (const { id } of await rows(`select id from campaigns where status in ('running', 'paused', 'scheduled')`)) {
      await call(ADMIN, 'POST', `${base()}/campaigns/${id}/cancel`);
    }
  };

  it('only a super admin can ask; every client’s campaigns can be listed and filtered', async () => {
    const id = await campaign(1);
    expect((await call(ASHA, 'GET', `/api/admin/campaigns/${id}/diagnosis`)).statusCode).toBe(403);
    expect((await call(MEERA, 'GET', '/api/admin/campaigns')).statusCode).toBe(403);
    const list = (await call(ADMIN, 'GET', `/api/admin/campaigns?clientId=${w.ids.northwind}&status=draft`)).json().items;
    expect(list.map((c: { id: string }) => c.id)).toContain(id);
    expect(list[0].clientName).toBe('Northwind Labs');
    expect((await call(ADMIN, 'GET', `/api/admin/campaigns?clientId=${w.ids.greenleaf}`)).json().items).toEqual([]);
    expect((await call(ADMIN, 'GET', '/api/admin/campaigns/nope/diagnosis')).statusCode).toBe(404);
  });

  it('names a short balance, with the amounts', async () => {
    const id = await campaign(2);
    const balance = await readBalance(w.db, w.ids.northwind);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/adjustments`, { amountPaise: -balance + PRICE, note: 'leave one' });
    const body = await why(id);
    expect(body.reasons[0].code).toBe('INSUFFICIENT_BALANCE');
    expect(body.headline).toContain('₹0.95 short');
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: 10000000 });
    expect(await codes(id)).toEqual([]);
  });

  it('names a template no longer approved, a paused number, and a suspended client', async () => {
    const id = await campaign(1);
    await w.pool.query(`update templates set status = 'PAUSED' where id = $1`, [templateId]);
    expect(await codes(id)).toContain('TEMPLATE_NOT_APPROVED');
    await w.pool.query(`update templates set status = 'APPROVED' where id = $1`, [templateId]);

    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'Quality dropped to Low'`);
    const paused = await why(id);
    expect(paused.reasons[0].code).toBe('ACCOUNT_PAUSED');
    expect(paused.headline).toContain('Quality dropped to Low');
    await w.pool.query(`update wa_accounts set status = 'active', paused_reason = null`);

    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/suspend`, { note: 'x' });
    expect(await codes(id)).toContain('CLIENT_SUSPENDED');
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/reactivate`, { note: 'x' });
  });

  it('names a paused campaign, a scheduled one, and what is ahead in the queue', async () => {
    await stopAll();
    const first = await running(3);
    const second = await running(2);
    const body = await why(second);
    expect(body.queue).toMatchObject({ waiting: 2, aheadOnNumber: 3 });
    expect(body.headline).toContain('3 earlier messages');
    expect(body.estimate.messagesAhead).toBe(5);

    await call(ASHA, 'POST', `${base()}/campaigns/${first}/pause`);
    expect(await codes(first)).toEqual(['CAMPAIGN_PAUSED']);
    expect((await why(second)).queue.aheadOnNumber).toBe(0);
    await stopAll();

    const later = await campaign(1);
    await call(ASHA, 'POST', `${base()}/campaigns/${later}/schedule`, { at: new Date(CLOCK.getTime() + 3600000).toISOString() });
    expect(await codes(later)).toEqual(['SCHEDULED']);
    await stopAll();
  });

  it('names the daily limit, with how many wait', async () => {
    await stopAll();
    const account = (await rows('select id from wa_accounts'))[0].id;
    const used = (await call(ADMIN, 'GET', '/api/admin/limits-usage')).json().items[0].usedLast24Hours;
    await call(ADMIN, 'PATCH', `/api/admin/wa-accounts/${account}/limits`, { dailySendLimit: used + 1 });
    const id = await running(3);
    await send(CLOCK);
    const body = await why(id);
    expect(body.reasons[0].code).toBe('DAILY_LIMIT_REACHED');
    expect(body.limits).toMatchObject({ dailySetting: used + 1, remainingToday: 0 });
    expect(body.headline).toContain('2 messages are waiting');
    await call(ADMIN, 'PATCH', `/api/admin/wa-accounts/${account}/limits`, { dailySendLimit: null });
    await stopAll();
  });

  it('names Meta’s rate limit, a send with no answer, and a retry', async () => {
    await stopAll();
    const id = await running(3);
    fake.queueSendResponses(metaError(400, 130429, 'too fast'), metaError(500, 131000, 'oops'), { status: 200, delayMs: 800 });
    await send(CLOCK);
    const found = await codes(id);
    expect(found).toEqual(expect.arrayContaining(['META_RATE_LIMITED', 'WAITING_FOR_META_ANSWER']));
    await stopAll();
  });

  it('says when sending is normal, and when nothing explains a stop', async () => {
    await stopAll();
    const id = await running(1);
    expect((await why(id)).reasons).toEqual([]);
    expect((await why(id)).headline).toBe('Sending normally.');
    const [{ id: msg }] = await rows('select id from messages where campaign_id = $1', [id]);
    await w.pool.query(`update messages set sent_at = $1 where id = $2`, [new Date('2026-11-02T09:00:00Z'), msg]);
    await w.pool.query(`update wa_accounts set daily_send_limit = null`);
    expect(await codes(id)).toEqual(['STALLED']);
    await stopAll();
  });
});

describe('what an admin needs and could not do', () => {
  it('lists users and staff, with their clients', async () => {
    const staff = (await call(ADMIN, 'GET', '/api/admin/users?role=staff')).json().items;
    expect(staff.map((u: { email: string }) => u.email)).toEqual([MEERA]);
    expect(staff[0].assignedClientIds).toEqual(expect.arrayContaining([w.ids.northwind, w.ids.bluebird]));
    expect(JSON.stringify(staff)).not.toContain('password');
    const own = (await call(ADMIN, 'GET', `/api/admin/users?clientId=${w.ids.northwind}`)).json().items;
    expect(own.map((u: { email: string }) => u.email)).toEqual([ASHA]);
    expect((await call(ADMIN, 'GET', '/api/admin/users?role=nope')).statusCode).toBe(400);
  });

  it('sees opt-outs and can undo one added by mistake, which unblocks the number', async () => {
    const number = String(nextNumber);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: [number] });
    const listed = (await call(ADMIN, 'GET', `/api/admin/clients/${w.ids.northwind}/opt-outs`)).json().items;
    expect(listed.map((o: { number: string }) => o.number)).toContain(`91${number}`);
    const id = await campaign(1);
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().blocked.total).toBe(1);

    expect((await call(ASHA, 'DELETE', `/api/admin/clients/${w.ids.northwind}/opt-outs/91${number}`)).statusCode).toBe(403);
    expect((await call(ADMIN, 'DELETE', `/api/admin/clients/${w.ids.northwind}/opt-outs/91${number}`)).statusCode).toBe(200);
    expect((await call(ADMIN, 'DELETE', `/api/admin/clients/${w.ids.northwind}/opt-outs/91${number}`)).statusCode).toBe(404);
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().blocked.total).toBe(0);
    expect((await rows(`select count(*)::int as n from audit_logs where action = 'opt_out.removed'`))[0].n).toBe(1);
  });

  it('a suspended client: its users are out; the super admin can still see its money and stop its campaign', async () => {
    const id = await running(3);
    const notifiedBefore = (await rows(`select count(*)::int as n from notifications where event = 'campaign.stalled'`))[0].n;
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/suspend`, { note: 'unpaid' });
    expect((await call(ASHA, 'GET', `${base()}/wallet`)).json().error).toBe('CLIENT_SUSPENDED');
    expect((await call(MEERA, 'GET', `${base()}/wallet`)).json().error).toBe('CLIENT_SUSPENDED');
    expect((await call(ADMIN, 'GET', `${base()}/wallet/ledger`)).statusCode).toBe(200);

    // It waits on purpose, so no alert says it stalled, and it cannot be started.
    await watchCampaigns(w.db, new Date(CLOCK.getTime() + STALLED_AFTER_MS * 2));
    expect((await rows(`select count(*)::int as n from notifications where event = 'campaign.stalled'`))[0].n).toBe(notifiedBefore);
    expect((await call(ADMIN, 'POST', `${base()}/campaigns/${await draftWhileSuspended()}/confirm`)).json().error).toBe('CLIENT_SUSPENDED');

    fake.requests.length = 0;
    await send();
    expect(fake.sends()).toEqual([]);

    const before = await readBalance(w.db, w.ids.northwind);
    expect((await call(ADMIN, 'POST', `${base()}/campaigns/${id}/cancel`)).statusCode).toBe(200);
    expect(await readBalance(w.db, w.ids.northwind)).toBe(before + 3 * PRICE);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/reactivate`, { note: 'paid' });
    await expectCountersAgree(id);
  });

  const draftWhileSuspended = async () => {
    const [{ id }] = await rows(`select id from campaigns where status = 'draft' and list_id is not null order by created_at desc limit 1`);
    return id as string;
  };

  it('a message refunded after cancelling, that Meta had really sent, shows in the double-send figures', async () => {
    const id = await running(1);
    await call(ASHA, 'POST', `${base()}/campaigns/${id}/cancel`);
    const [{ id: messageId }] = await rows('select id from messages where campaign_id = $1', [id]);
    await store(statusWebhook('wamid.late', 'sent', 1_800_000_000, { biz_opaque_callback_data: String(messageId) }));
    expect(await processEvents(w.db)).toMatchObject({ errored: 0 });
    const stats = await readSendStats(w.db, new Date('2020-01-01'));
    expect(stats.find((s) => s.client === 'Northwind Labs')?.failed_but_sent).toBeGreaterThan(0);
  });
});
