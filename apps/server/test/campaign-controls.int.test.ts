import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaClient } from '../src/lib/meta-client.js';
import { startDueCampaigns } from '../src/modules/campaigns/controls.js';
import { watchCampaigns } from '../src/modules/campaigns/monitor.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { AccountPacer, sendDue } from '../src/modules/messaging/sender.js';
import { checkLedgers, readBalance } from '../src/modules/wallet/ledger.js';
import { FakeMeta, HELLO_WORLD, metaError, statusWebhook } from './support/fake-meta.js';
import { createWorld, PANEL } from './support/world.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const OTHER = 'sales@greenleaf.in';
const CLOCK = new Date('2026-11-02T10:00:00Z');
const later = (ms = 1000) => new Date(CLOCK.getTime() + ms);
const PRICE = 95;

const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-controls-'));
const fake = new FakeMeta();
let w: Awaited<ReturnType<typeof createWorld>>;
let app: ReturnType<Awaited<ReturnType<typeof createWorld>>['makeApp']>;
let meta: MetaClient;
let marketing = '';
let utility = '';
const cookies: Record<string, string> = {};

const call = (email: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: cookies[email]!, origin: PANEL }, ...(payload ? { payload } : {}) });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const base = (clientId = w.ids.northwind) => `/api/clients/${clientId}`;
const send = (now = later()) => sendDue({ db: w.db, meta, encryptionKey: KEY, pacer: new AccountPacer() }, now);
const balance = () => readBalance(w.db, w.ids.northwind);
const topup = (amountPaise: number) => call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise });

const draft = async (count: number, templateId = marketing, first = 9000000000) => {
  const csv = ['Name,Mobile', ...Array.from({ length: count }, (_, i) => `A,${first + i}`)].join('\n');
  const list = await app.inject({
    method: 'POST',
    url: `${base()}/lists?fileName=a.csv&optIn=true`,
    headers: { cookie: cookies[ASHA]!, origin: PANEL, 'content-type': 'text/csv' },
    payload: csv,
  });
  const listId = list.json().id;
  await call(ASHA, 'PUT', `${base()}/lists/${listId}/number-column`, { column: 1 });
  const res = await call(ASHA, 'POST', `${base()}/campaigns`, { name: 'Diwali wave 2', templateId, listId, variableMap: {} });
  return res.json().id as string;
};
const running = async (count: number, templateId = marketing) => {
  const id = await draft(count, templateId);
  const res = await call(ASHA, 'POST', `${base()}/campaigns/${id}/confirm`);
  expect(res.statusCode).toBe(200);
  return id;
};
const act = (id: string, what: string, email = ASHA, payload?: object) => call(email, 'POST', `${base()}/campaigns/${id}/${what}`, payload);
const campaign = async (id: string) => (await call(ASHA, 'GET', `${base()}/campaigns/${id}`)).json();
const counts = async (id: string) =>
  Object.fromEntries((await rows('select status, count(*)::int as n from messages where campaign_id = $1 group by status', [id])).map((r) => [r.status, r.n]));

beforeAll(async () => {
  w = await createWorld();
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 500 });
  app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir });
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email)).cookie;
  fake.templates = [
    { ...HELLO_WORLD, id: 'promo', name: 'promo', category: 'MARKETING', components: [{ type: 'BODY', text: 'Sale today, friends.' }] },
    { ...HELLO_WORLD, id: 'promo2', name: 'promo_two', category: 'MARKETING', components: [{ type: 'BODY', text: 'More sale today.' }] },
    { ...HELLO_WORLD, id: 'order', name: 'order', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your order shipped.' }] },
  ];
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' });
  marketing = (await rows(`select id from templates where name = 'promo'`))[0].id;
  utility = (await rows(`select id from templates where name = 'order'`))[0].id;
  for (const category of ['MARKETING', 'UTILITY']) {
    await call(ADMIN, 'POST', '/api/admin/meta-rates', { category, countryCallingCode: '91', rateCentipaise: 7600, validFrom: '2026-01-01T00:00:00Z' });
  }
});

beforeEach(async () => {
  await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
  await w.pool.query('truncate wallet_ledger, message_status_events, meta_events, notifications, messages, rules restart identity cascade');
  await w.pool.query('delete from campaigns');
  await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');
  await w.pool.query(`update wa_accounts set status = 'active', paused_reason = null, send_rate_per_sec = 500`);
  fake.requests.length = 0;
  await topup(10000000);
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('8.1 pause and resume', () => {
  it('a paused campaign sends nothing, moves no money, and carries on when resumed', async () => {
    const id = await running(5);
    const before = await balance();
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 2`);
    await send();
    expect((await counts(id)).sent).toBe(2);

    expect((await act(id, 'pause', MEERA)).json()).toEqual({ status: 'paused' });
    fake.requests.length = 0;
    await send();
    expect(fake.sends()).toEqual([]);
    expect(await balance()).toBe(before);
    expect((await rows(`select count(*) from wallet_ledger where kind = 'refund'`))[0].count).toBe(0);

    expect((await act(id, 'pause')).json().error).toBe('WRONG_STATUS');
    await act(id, 'resume');
    await send();
    expect((await counts(id)).sent).toBe(4);
    expect((await rows(`select count(*) from audit_logs where entity_id = $1 and action in ('campaign.paused', 'campaign.resumed')`, [id]))[0].count).toBe(2);
  });

  it('another client cannot touch it; a paused campaign is not marked complete', async () => {
    const id = await running(1);
    expect((await call(OTHER, 'POST', `${base(w.ids.greenleaf)}/campaigns/${id}/pause`)).statusCode).toBe(404);
    expect((await call(OTHER, 'POST', `${base(w.ids.greenleaf)}/campaigns/${id}/cancel`)).statusCode).toBe(404);
    await send();
    await act(id, 'pause');
    await watchCampaigns(w.db, later());
    expect((await campaign(id)).status).toBe('paused');
  });
});

describe('8.2 cancel', () => {
  it('runs the worked example: exact refund in one row, sending finishes normally, nightly check clean', async () => {
    const id = await running(10);
    const charged = 10 * PRICE;
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 3`);
    await send();
    // 3 sent. One more claimed by the worker at this instant.
    const [{ id: inFlight }] = await rows(`select id from messages where campaign_id = $1 and status = 'queued' order by id limit 1`, [id]);
    await w.pool.query(`update messages set status = 'sending', locked_at = now(), meta_message_id = 'wamid.inflight' where id = $1`, [inFlight]);

    const res = await act(id, 'cancel');
    expect(res.json()).toEqual({ status: 'cancelled', cancelled: 6, refundPaise: 6 * PRICE });
    expect(await counts(id)).toEqual({ sent: 3, sending: 1, blocked: 6 });
    const refunds = await rows(`select amount_paise, note, message_id from wallet_ledger where kind = 'refund'`);
    expect(refunds).toEqual([{ amount_paise: 6 * PRICE, note: '6 messages cancelled', message_id: null }]);
    expect((await rows(`select block_reason, count(*)::int as n from messages where status = 'blocked' group by 1`))[0]).toEqual({ block_reason: 'campaign_cancelled', n: 6 });
    expect((await campaign(id)).blocked).toBe(6);

    // The in-flight one fails at Meta, so M7's refund applies, and cancel is not refunded twice.
    await sql`insert into meta_events (body) values (${statusWebhook('wamid.inflight', 'failed', 1_800_000_000, { errors: [{ code: 131026, title: 'x' }] })}::jsonb)`.execute(w.db);
    await processEvents(w.db);
    const net = (await rows(`select -sum(amount_paise)::bigint as net from wallet_ledger where campaign_id = $1`, [id]))[0].net;
    expect(net).toBe(charged - 7 * PRICE);
    expect(net).toBe(3 * PRICE);
    expect(await checkLedgers(w.db)).toEqual([]);

    await sendsNothing();
  });

  const sendsNothing = async () => {
    fake.requests.length = 0;
    await send(later(10_000_000));
    expect(fake.sends()).toEqual([]);
  };

  it('a second cancel changes nothing; a finished or draft campaign cannot be cancelled', async () => {
    const id = await running(3);
    await act(id, 'cancel');
    const after = await balance();
    const again = await act(id, 'cancel');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('ALREADY_CANCELLED');
    expect(await balance()).toBe(after);
    expect((await act(await draft(1), 'cancel')).json().error).toBe('WRONG_STATUS');
  });

  it('two cancels at once refund once; a paused campaign can be cancelled', async () => {
    const id = await running(4);
    await act(id, 'pause');
    const before = await balance();
    const results = await Promise.all([act(id, 'cancel'), act(id, 'cancel')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await balance()).toBe(before + 4 * PRICE);
  });

  it('holds up with the worker running during the cancel: every message is accounted for', async () => {
    const id = await running(300);
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 20`);
    const worker = (async () => {
      for (let i = 0; i < 40; i++) {
        await send(later(i * 1000));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const res = await act(id, 'cancel');
    await worker;
    const seen = await counts(id);
    expect(seen.queued).toBeUndefined();
    expect(seen.sending).toBeUndefined();
    expect((seen.sent ?? 0) + (seen.blocked ?? 0)).toBe(300);
    expect(seen.blocked).toBe(res.json().cancelled);
    expect(fake.sends()).toHaveLength(seen.sent ?? 0);
    const net = (await rows(`select -sum(amount_paise)::bigint as net from wallet_ledger where campaign_id = $1`, [id]))[0].net;
    expect(net).toBe((seen.sent ?? 0) * PRICE);
    expect(await checkLedgers(w.db)).toEqual([]);
    const totals = await campaign(id);
    expect([totals.sent, totals.blocked]).toEqual([seen.sent ?? 0, seen.blocked]);
  });

  it('cancelled with a permanent failure in the same batch stays exact', async () => {
    const id = await running(6);
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 2`);
    fake.queueSendResponses(metaError(400, 131026));
    await send();
    await act(id, 'cancel');
    const net = (await rows(`select -sum(amount_paise)::bigint as net from wallet_ledger where campaign_id = $1`, [id]))[0].net;
    expect(net).toBe(PRICE);
    expect(await checkLedgers(w.db)).toEqual([]);
  });
});

describe('8.3 schedule', () => {
  const at = (ms: number) => new Date(CLOCK.getTime() + ms).toISOString();

  it('moves no money when scheduled; starts when due, charges then, and tells people', async () => {
    const id = await draft(3);
    const before = await balance();
    const res = await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    expect(res.json().status).toBe('scheduled');
    expect(await balance()).toBe(before);

    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 9 * 60_000));
    expect((await campaign(id)).status).toBe('scheduled');
    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 10 * 60_000));
    expect((await campaign(id)).status).toBe('running');
    expect(await balance()).toBe(before - 3 * PRICE);
    expect((await counts(id)).queued).toBe(3);
    expect((await rows(`select count(*) from notifications where event = 'campaign.scheduled_started' and channel = 'email'`))[0].count).toBeGreaterThan(0);

    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 11 * 60_000));
    expect(await balance()).toBe(before - 3 * PRICE);
  });

  it('too soon, a bad time, a campaign not ready and a non-draft are refused', async () => {
    const id = await draft(1);
    expect((await act(id, 'schedule', ASHA, { at: at(4 * 60_000) })).json().error).toBe('TOO_SOON');
    expect((await act(id, 'schedule', ASHA, { at: 'tomorrow' })).statusCode).toBe(400);
    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'x'`);
    expect((await act(id, 'schedule', ASHA, { at: at(10 * 60_000) })).json().error).toBe('ACCOUNT_PAUSED');
    await w.pool.query(`update wa_accounts set status = 'active', paused_reason = null`);
    await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    expect((await act(id, 'schedule', ASHA, { at: at(20 * 60_000) })).json().error).toBe('WRONG_STATUS');
    expect((await call(ASHA, 'PUT', `${base()}/campaigns/${id}`, { name: 'x' })).json().error).toBe('NOT_A_DRAFT');
    expect((await act(id, 'confirm')).json().error).toBe('ALREADY_CONFIRMED');
  });

  it('can go back to draft, or be cancelled with no money moved', async () => {
    const id = await draft(1);
    await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    expect((await act(id, 'unschedule')).json().status).toBe('draft');
    expect((await act(id, 'unschedule')).json().error).toBe('WRONG_STATUS');
    await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    const before = await balance();
    expect((await act(id, 'cancel')).json()).toEqual({ status: 'cancelled', cancelled: 0, refundPaise: 0 });
    expect(await balance()).toBe(before);
    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 20 * 60_000));
    expect((await campaign(id)).status).toBe('cancelled');
  });

  it('a short balance at start returns it to draft with no ledger row, and tells super admins', async () => {
    const id = await draft(3);
    await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/adjustments`, { amountPaise: -(await balance()), note: 'empty it' });

    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 10 * 60_000));
    expect((await campaign(id)).status).toBe('draft');
    expect((await rows(`select count(*) from messages where campaign_id = $1`, [id]))[0].count).toBe(0);
    expect((await rows(`select count(*) from wallet_ledger where campaign_id = $1`, [id]))[0].count).toBe(0);
    const told = await rows(`select email from notifications where event = 'campaign.scheduled_not_started' and channel = 'email' order by email`);
    expect(told.map((r) => r.email)).toContain(ADMIN);
  });

  it('a number paused since scheduling returns it to draft too', async () => {
    const id = await draft(1);
    await act(id, 'schedule', ASHA, { at: at(10 * 60_000) });
    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'Quality dropped to Low'`);
    await startDueCampaigns(w.db, new Date(CLOCK.getTime() + 10 * 60_000));
    expect((await campaign(id)).status).toBe('draft');
    const [{ payload }] = await rows(`select payload from notifications where event = 'campaign.scheduled_not_started' limit 1`);
    expect(payload.reason).toContain('Quality dropped to Low');
  });
});

describe('8.4 rules', () => {
  const rule = (body: object, email = ADMIN) => call(email, 'PUT', '/api/admin/rules', body);
  const blockedBy = async (id: string) => (await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().blocked.byReason;

  it('no repeat within X hours: on, off, for all clients and for one client', async () => {
    await running(3);
    await send();
    const next = await draft(5);
    expect(await blockedBy(next)).toEqual({});

    expect((await rule({ type: 'repeat_within_hours', values: { hours: 24 }, enabled: true })).statusCode).toBe(200);
    expect(await blockedBy(next)).toEqual({ repeat_within_24h: 3 });
    const other = await draft(5, (await rows(`select id from templates where name = 'promo_two'`))[0].id);
    expect(await blockedBy(other)).toEqual({});

    await rule({ clientId: w.ids.northwind, type: 'repeat_within_hours', values: { hours: 24 }, enabled: false });
    expect(await blockedBy(next)).toEqual({});
    await rule({ clientId: w.ids.greenleaf, type: 'repeat_within_hours', values: { hours: 24 }, enabled: true });
    expect(await blockedBy(next)).toEqual({});
    await rule({ clientId: w.ids.northwind, type: 'repeat_within_hours', values: { hours: 48 }, enabled: true });
    expect(await blockedBy(next)).toEqual({ repeat_within_48h: 3 });

    await rule({ clientId: w.ids.northwind, type: 'repeat_within_hours', values: { hours: 1 }, enabled: true });
    await w.pool.query(`update messages set queued_at = now() - interval '2 years'`);
    expect(await blockedBy(next)).toEqual({});
  });

  it('a failed or cancelled send does not count as a repeat', async () => {
    const first = await running(2);
    await act(first, 'cancel');
    await rule({ type: 'repeat_within_hours', values: { hours: 24 }, enabled: true });
    expect(await blockedBy(await draft(2))).toEqual({});
  });

  it('a marketing cap blocks marketing only, and only this client when set for it', async () => {
    await running(2);
    await send();
    await rule({ clientId: w.ids.northwind, type: 'marketing_cap', values: { count: 1, period: 'week' }, enabled: true });
    expect(await blockedBy(await draft(3))).toEqual({ marketing_cap: 2 });
    expect(await blockedBy(await draft(3, utility))).toEqual({});
    await rule({ clientId: w.ids.northwind, type: 'marketing_cap', values: { count: 2, period: 'week' }, enabled: true });
    expect(await blockedBy(await draft(3))).toEqual({});
  });

  it('a blocked number is charged and not sent, as the design says, and earlier reasons win', async () => {
    await running(2);
    await send();
    await rule({ type: 'repeat_within_hours', values: { hours: 24 }, enabled: true });
    const id = await draft(3);
    const before = await balance();
    await act(id, 'confirm');
    expect(await balance()).toBe(before - 3 * PRICE);
    expect(await counts(id)).toEqual({ queued: 1, blocked: 2 });
    fake.requests.length = 0;
    await send();
    expect(fake.sends()).toHaveLength(1);
  });

  it('only a super admin changes rules; changes are audited; bad rules are refused', async () => {
    expect((await rule({ type: 'marketing_cap', values: { count: 1, period: 'week' }, enabled: true }, ASHA)).statusCode).toBe(403);
    expect((await call(MEERA, 'GET', '/api/admin/rules')).statusCode).toBe(403);
    expect((await rule({ type: 'nope', values: {}, enabled: true })).statusCode).toBe(400);
    expect((await rule({ type: 'marketing_cap', values: { count: 0, period: 'week' }, enabled: true })).statusCode).toBe(400);
    expect((await rule({ type: 'repeat_within_hours', values: { hours: 24 }, enabled: true, clientId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    await rule({ type: 'repeat_within_hours', values: { hours: 24 }, enabled: true });
    await rule({ type: 'repeat_within_hours', values: { hours: 12 }, enabled: true });
    expect((await call(ADMIN, 'GET', '/api/admin/rules')).json().items).toHaveLength(1);
    const [audit] = await rows(`select details from audit_logs where action = 'rule.changed' order by id desc limit 1`);
    expect(audit.details.before.values).toEqual({ hours: 24 });
    expect(audit.details.after.values).toEqual({ hours: 12 });
  });
});

describe('8.5 notifications', () => {
  it('pause and resume say who did it; cancel gives the refund, by email and panel', async () => {
    const id = await running(2);
    await act(id, 'pause', MEERA);
    const [paused] = await rows(`select payload, channel from notifications where event = 'campaign.paused' limit 1`);
    expect(paused.channel).toBe('panel');
    expect(paused.payload.by).toBe('meera');
    await act(id, 'resume', MEERA);
    await act(id, 'cancel');
    const [cancelled] = await rows(`select payload from notifications where event = 'campaign.cancelled' and channel = 'email' limit 1`);
    expect(cancelled.payload).toMatchObject({ cancelled: 2, refundPaise: 2 * PRICE });
  });
});
