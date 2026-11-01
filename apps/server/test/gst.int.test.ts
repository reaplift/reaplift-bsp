import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaClient } from '../src/lib/meta-client.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { AccountPacer, sendDue } from '../src/modules/messaging/sender.js';
import { priceWithGst, splitGst } from '../src/modules/wallet/gst.js';
import { checkLedgers, readBalance } from '../src/modules/wallet/ledger.js';
import { FakeMeta, HELLO_WORLD, metaError, statusWebhook } from './support/fake-meta.js';
import { createWorld, PANEL } from './support/world.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const OTHER = 'sales@greenleaf.in';
const MONTH = '2026-11';
const CLOCK = new Date('2026-11-02T10:00:00Z');
const FUTURE = new Date('2026-11-03T00:00:00Z');
// A fixed 88 paise, as the owner's example: with 18% GST, 103.84 rounds up to 104.
const PRICE = 88;
const WITH_GST = 104;
const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-gst-'));
const fake = new FakeMeta();
let w: Awaited<ReturnType<typeof createWorld>>;
let app: ReturnType<Awaited<ReturnType<typeof createWorld>>['makeApp']>;
let meta: MetaClient;
let templateId = '';
const cookies: Record<string, string> = {};
let nextNumber = 9000000000;

const call = (email: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: cookies[email]!, origin: PANEL }, ...(payload ? { payload } : {}) });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const base = () => `/api/clients/${w.ids.northwind}`;
const send = () => sendDue({ db: w.db, meta, encryptionKey: KEY, pacer: new AccountPacer() }, FUTURE);
const balance = () => readBalance(w.db, w.ids.northwind);
const setRate = (rateBp: number, validFrom = '2026-11-01T00:00:00Z') =>
  call(ADMIN, 'POST', '/api/admin/gst-rates', { rateBp, validFrom });

const draft = async (count: number) => {
  const csv = ['Name,Mobile', ...Array.from({ length: count }, () => `A,${nextNumber++}`)].join('\n');
  const list = await app.inject({
    method: 'POST',
    url: `${base()}/lists?fileName=a.csv&optIn=true`,
    headers: { cookie: cookies[ASHA]!, origin: PANEL, 'content-type': 'text/csv' },
    payload: csv,
  });
  await call(ASHA, 'PUT', `${base()}/lists/${list.json().id}/number-column`, { column: 1 });
  return (await call(ASHA, 'POST', `${base()}/campaigns`, { name: 'c', templateId, listId: list.json().id, variableMap: {} })).json().id as string;
};
const running = async (count: number) => {
  const id = await draft(count);
  expect((await call(ASHA, 'POST', `${base()}/campaigns/${id}/confirm`)).statusCode).toBe(200);
  return id;
};
const statement = async () => (await call(ASHA, 'GET', `${base()}/wallet/statement?month=${MONTH}`)).json().lines;

beforeAll(async () => {
  w = await createWorld();
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 500 });
  app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir });
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email)).cookie;
  fake.templates = [{ ...HELLO_WORLD, id: 'promo', name: 'promo', category: 'MARKETING', components: [{ type: 'BODY', text: 'Sale today, friends.' }] }];
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' });
  templateId = (await rows(`select id from templates where name = 'promo'`))[0].id;
  await w.pool.query(`update wa_accounts set send_rate_per_sec = 500`);
  await call(ADMIN, 'POST', '/api/admin/meta-rates', { category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 8600, validFrom: '2026-01-01T00:00:00Z' });
  await call(ADMIN, 'PUT', `/api/admin/clients/${w.ids.northwind}/pricing`, { mode: 'fixed', fixedPaise: { marketing: PRICE, utility: 15, authentication: 15 } });
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: 10000000 });
});

beforeEach(async () => {
  await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
  await w.pool.query(`delete from wallet_ledger where kind in ('charge', 'refund')`);
  await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');
  await w.pool.query('delete from message_status_events');
  await w.pool.query('delete from meta_events');
  await w.pool.query('delete from wallet_holds');
  await w.pool.query('delete from messages');
  await w.pool.query('delete from campaigns');
  await w.pool.query(`delete from gst_rates where valid_from >= '2026-01-01'`);
  await setRate(1800);
  fake.requests.length = 0;
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the sums', () => {
  it('the owner’s examples, rounded up to a whole paisa', () => {
    expect(priceWithGst(88, 1800)).toBe(104); // 103.84
    expect(priceWithGst(86, 1800)).toBe(102); // 101.48
    expect(priceWithGst(100, 1800)).toBe(118);
    expect(priceWithGst(88, 0)).toBe(88);
  });

  it('splitting gives back exactly the rate, and the parts always add up', () => {
    expect(splitGst(11800, 1800)).toEqual({ taxablePaise: 10000, gstPaise: 1800 });
    expect(splitGst(0, 1800)).toEqual({ taxablePaise: 0, gstPaise: 0 });
    for (const total of [1, 104, 999, 123457, 19000000]) {
      const { taxablePaise, gstPaise } = splitGst(total, 1800);
      expect(taxablePaise + gstPaise).toBe(total);
      expect(Math.abs(gstPaise - taxablePaise * 0.18)).toBeLessThanOrEqual(1);
    }
  });
});

describe('what a client is charged', () => {
  it('shows the price with and without GST, and charges with it', async () => {
    const price = (await call(ASHA, 'GET', `${base()}/prices`)).json().items.find((p: { category: string }) => p.category === 'MARKETING');
    expect(price).toEqual({ category: 'MARKETING', pricePaise: PRICE, gstBp: 1800, priceWithGstPaise: WITH_GST });

    const before = await balance();
    const id = await draft(10);
    const summary = (await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json();
    expect(summary).toMatchObject({ pricePaise: PRICE, gstBp: 1800, priceWithGstPaise: WITH_GST, chargePaise: 10 * WITH_GST });

    await call(ASHA, 'POST', `${base()}/campaigns/${id}/confirm`);
    expect(await balance()).toBe(before - 10 * WITH_GST);
    const [charge] = await rows(`select amount_paise, gst_bp from wallet_ledger where kind = 'charge'`);
    expect(charge).toEqual({ amount_paise: -10 * WITH_GST, gst_bp: 1800 });
    const [message] = await rows('select client_price_paise, gst_bp from messages limit 1');
    expect(message).toEqual({ client_price_paise: WITH_GST, gst_bp: 1800 });
    expect(await checkLedgers(w.db)).toEqual([]);
  });

  it('a short balance is judged on the price with GST', async () => {
    const id = await draft(1);
    const all = await balance();
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/adjustments`, { amountPaise: -all + PRICE, note: 'enough without GST only' });
    const res = await call(ASHA, 'POST', `${base()}/campaigns/${id}/confirm`);
    expect(res.statusCode).toBe(402);
    expect(res.json().shortPaise).toBe(WITH_GST - PRICE);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: 10000000 });
  });

  it('holds a scheduled campaign’s charge with GST, and gives it all back on cancel', async () => {
    const id = await draft(5);
    const before = await balance();
    const at = new Date(CLOCK.getTime() + 3600000).toISOString();
    const res = await call(ASHA, 'POST', `${base()}/campaigns/${id}/schedule`, { at });
    expect(res.json().heldPaise).toBe(5 * WITH_GST);
    await call(ASHA, 'POST', `${base()}/campaigns/${id}/cancel`);
    expect(await balance()).toBe(before);
    expect((await call(ASHA, 'GET', `${base()}/wallet`)).json().onHoldPaise).toBe(0);
  });
});

describe('refunds', () => {
  it('a message failing at send and one failing by webhook each refund the full price with GST, once', async () => {
    const before = await balance();
    const id = await running(3);
    fake.queueSendResponses(metaError(400, 131026));
    await send();
    const [{ w: wamid }] = await rows(`select meta_message_id as w from messages where campaign_id = $1 and meta_message_id is not null order by id limit 1`, [id]);
    const failed = statusWebhook(wamid, 'failed', 1_800_000_000, { errors: [{ code: 131026, title: 'x' }] });
    for (let i = 0; i < 2; i++) await sql`insert into meta_events (body) values (${failed}::jsonb)`.execute(w.db);
    await processEvents(w.db, CLOCK);

    expect(await balance()).toBe(before - WITH_GST);
    const refunds = await rows(`select amount_paise, gst_bp from wallet_ledger where kind = 'refund'`);
    expect(refunds).toEqual([{ amount_paise: WITH_GST, gst_bp: 1800 }, { amount_paise: WITH_GST, gst_bp: 1800 }]);
    expect(await checkLedgers(w.db)).toEqual([]);
  });

  it('cancelling refunds unsent messages with GST, recorded at the campaign’s rate', async () => {
    const before = await balance();
    const id = await running(4);
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 1`);
    await send();
    await w.pool.query(`update wa_accounts set send_rate_per_sec = 500`);
    await setRate(2000);
    const res = await call(ASHA, 'POST', `${base()}/campaigns/${id}/cancel`);
    expect(res.json()).toMatchObject({ cancelled: 3, refundPaise: 3 * WITH_GST });
    expect(await balance()).toBe(before - WITH_GST);
    expect((await rows(`select gst_bp from wallet_ledger where kind = 'refund'`))[0].gst_bp).toBe(1800);
    expect(await checkLedgers(w.db)).toEqual([]);
  });
});

describe('changing the rate', () => {
  it('applies from its date; a confirmed campaign keeps its rate; history stays', async () => {
    const first = await running(1);
    const change = await setRate(2800);
    expect(change.statusCode).toBe(201);
    expect((await call(ADMIN, 'GET', '/api/admin/gst-rates')).json().currentBp).toBe(2800);

    const second = await draft(1);
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${second}/summary`)).json()).toMatchObject({ gstBp: 2800, priceWithGstPaise: 113 });
    expect((await rows('select client_price_paise, gst_bp from messages where campaign_id = $1', [first]))[0]).toEqual({ client_price_paise: WITH_GST, gst_bp: 1800 });

    const future = await setRate(500, new Date(CLOCK.getTime() + 86400000).toISOString());
    expect(future.statusCode).toBe(201);
    expect((await call(ADMIN, 'GET', '/api/admin/gst-rates')).json().currentBp).toBe(2800);
    expect((await call(ADMIN, 'GET', '/api/admin/gst-rates')).json().items.length).toBeGreaterThanOrEqual(3);
    const [audit] = await rows(`select details from audit_logs where action = 'gst_rate.added' order by id desc limit 1`);
    expect(audit.details.after.rateBp).toBe(500);
  });

  it('only a super admin changes it, within sensible bounds', async () => {
    for (const email of [ASHA, MEERA]) {
      expect((await call(email, 'POST', '/api/admin/gst-rates', { rateBp: 1800, validFrom: '2026-11-01T00:00:00Z' })).statusCode).toBe(403);
      expect((await call(email, 'GET', '/api/admin/gst-report?month=2026-11')).statusCode).toBe(403);
    }
    for (const rateBp of [-1, 5001, 18.5]) expect((await setRate(rateBp)).statusCode).toBe(400);
    expect((await call(ADMIN, 'POST', '/api/admin/gst-rates', { rateBp: 1800 })).statusCode).toBe(400);
  });
});

describe('statements and reports', () => {
  it('splits per rate, nets refunds off GST, and leaves top-ups out', async () => {
    await running(10);
    await setRate(2800);
    await running(5);
    await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
    await w.pool.query(`update wallet_ledger set created_at = $1 where kind in ('charge', 'refund')`, [CLOCK]);
    await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');

    const lines = await statement();
    const at18 = lines.find((l: { gstBp: number }) => l.gstBp === 1800);
    const at28 = lines.find((l: { gstBp: number }) => l.gstBp === 2800);
    expect(at18).toMatchObject({ chargedPaise: 1040, refundedPaise: 0, netPaise: 1040, taxablePaise: 881, gstPaise: 159 });
    expect(at28).toMatchObject({ chargedPaise: 5 * 113, netPaise: 565, taxablePaise: 441, gstPaise: 124 });
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/wallet/statement?month=${MONTH}`)).json().lines).toEqual([]);
    expect((await call(OTHER, 'GET', `${base()}/wallet/statement?month=${MONTH}`)).statusCode).toBe(404);
    expect((await call(ASHA, 'GET', `${base()}/wallet/statement?month=nope`)).statusCode).toBe(400);

    const report = (await call(ADMIN, 'GET', `/api/admin/gst-report?month=${MONTH}`)).json();
    expect(report.totals).toEqual({ netPaise: 1605, taxablePaise: 1322, gstPaise: 283 });
    expect(report.lines[0].clientName).toBe('Northwind Labs');
  });

  it('margin is without GST: GST collected is not income', async () => {
    const id = await running(10);
    await send();
    const hook = (await rows('select meta_message_id as w from messages where campaign_id = $1 order by id', [id])).map((r) => r.w);
    for (const wamid of hook) {
      await sql`insert into meta_events (body) values (${statusWebhook(wamid, 'delivered', Math.floor(CLOCK.getTime() / 1000), { pricing: { category: 'marketing', type: 'regular', billable: true } })}::jsonb)`.execute(w.db);
    }
    await processEvents(w.db, CLOCK);
    await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
    await w.pool.query(`update wallet_ledger set created_at = $1 where kind in ('charge', 'refund')`, [CLOCK]);
    await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');

    const client = (await call(ADMIN, 'GET', `/api/admin/meta-view?month=${MONTH}`)).json().clients.find((c: { name: string }) => c.name === 'Northwind Labs');
    expect(client).toMatchObject({ billedPaise: 881, gstPaise: 159, metaCostPaise: 860, marginPaise: 21 });
  });
});
