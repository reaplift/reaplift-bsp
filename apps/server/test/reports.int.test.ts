import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaClient } from '../src/lib/meta-client.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { AccountPacer, sendDue } from '../src/modules/messaging/sender.js';
import { reportTime } from '../src/modules/reports/routes.js';
import { checkCreditLine, refreshDailyStats } from '../src/modules/reports/stats.js';
import { FakeMeta, HELLO_WORLD, metaError, statusWebhook } from './support/fake-meta.js';
import { createWorld, PANEL } from './support/world.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const OTHER = 'sales@greenleaf.in';
// The world's clock: 15:30 on 2 November 2026, India time.
const NOW = new Date('2026-11-02T10:00:00Z');
const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-reports-'));
const fake = new FakeMeta();
let w: Awaited<ReturnType<typeof createWorld>>;
let app: ReturnType<Awaited<ReturnType<typeof createWorld>>['makeApp']>;
let meta: MetaClient;
let templateId = '';
const cookies: Record<string, string> = {};

const call = (email: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: cookies[email]!, origin: PANEL }, ...(payload ? { payload } : {}) });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const base = () => `/api/clients/${w.ids.northwind}`;
const store = (body: string) => sql`insert into meta_events (body) values (${body}::jsonb)`.execute(w.db);
const send = () => sendDue({ db: w.db, meta, encryptionKey: KEY, pacer: new AccountPacer() }, new Date('2026-11-03T00:00:00Z'));

const runCampaign = async (name: string, count: number, first = 9000000000) => {
  const csv = ['Name,Mobile', ...Array.from({ length: count }, (_, i) => `A,${first + i}`)].join('\n');
  const list = await app.inject({
    method: 'POST',
    url: `${base()}/lists?fileName=a.csv&optIn=true`,
    headers: { cookie: cookies[ASHA]!, origin: PANEL, 'content-type': 'text/csv' },
    payload: csv,
  });
  await call(ASHA, 'PUT', `${base()}/lists/${list.json().id}/number-column`, { column: 1 });
  const created = await call(ASHA, 'POST', `${base()}/campaigns`, { name, templateId, listId: list.json().id, variableMap: {} });
  expect((await call(ASHA, 'POST', `${base()}/campaigns/${created.json().id}/confirm`)).statusCode).toBe(200);
  return created.json().id as string;
};
const deliver = (wamid: string, extra: Record<string, unknown> = { pricing: { category: 'marketing', type: 'regular', billable: true } }) =>
  store(statusWebhook(wamid, 'delivered', Math.floor(NOW.getTime() / 1000), extra));
const wamids = async (campaignId: string) =>
  (await rows(`select meta_message_id from messages where campaign_id = $1 and status = 'sent' order by id`, [campaignId])).map((r) => r.meta_message_id as string);

/** A campaign ending as: 1 read, 1 delivered, 1 sent with no report, 1 failed at send, 1 failed after sending, 1 blocked. */
const mixed = async (name = 'Diwali 2026 wave 1') => {
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['9000000005'] });
  const id = await runCampaign(name, 6);
  fake.queueSendResponses(metaError(400, 131026, 'Message undeliverable'));
  await send();
  const [a, b, , d] = await wamids(id);
  await deliver(a!);
  await store(statusWebhook(a!, 'read', Math.floor(NOW.getTime() / 1000) + 5));
  await deliver(b!);
  await store(statusWebhook(d!, 'failed', Math.floor(NOW.getTime() / 1000), { errors: [{ code: 131049, title: 'Meta limit' }] }));
  await processEvents(w.db, NOW);
  await w.pool.query(`delete from opt_outs`);
  return id;
};

beforeAll(async () => {
  w = await createWorld();
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 500 });
  app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir });
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email)).cookie;
  fake.templates = [{ ...HELLO_WORLD, id: 'promo', name: 'promo', category: 'MARKETING', components: [{ type: 'BODY', text: 'Sale today, friends.' }] }];
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' });
  templateId = (await rows(`select id from templates where name = 'promo'`))[0].id;
  await call(ADMIN, 'POST', '/api/admin/meta-rates', { category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 7600, validFrom: '2026-01-01T00:00:00Z' });
  await call(ADMIN, 'POST', '/api/admin/meta-rates', { category: 'UTILITY', countryCallingCode: '91', rateCentipaise: 1150, validFrom: '2026-01-01T00:00:00Z' });
});

beforeEach(async () => {
  await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
  await w.pool.query('truncate wallet_ledger, message_status_events, meta_events, notifications, messages, daily_stats, meta_invoices restart identity cascade');
  await w.pool.query('delete from campaigns');
  await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');
  await w.pool.query(`delete from settings where key = 'credit_limit_paise'`);
  await w.pool.query(`update wa_accounts set send_rate_per_sec = 500`);
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wallet/topups`, { amountPaise: 1000000 });
  fake.requests.length = 0;
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('9.5 Meta cost per message', () => {
  it('uses Meta’s category and the rate valid at delivery, once, and free messages cost nothing', async () => {
    const id = await runCampaign('c', 4);
    await send();
    const [a, b, c, d] = await wamids(id);
    await deliver(a!);
    await deliver(a!, { pricing: { category: 'utility', type: 'regular', billable: true } });
    await deliver(b!, { pricing: { category: 'utility', type: 'regular', billable: true } });
    await deliver(c!, { pricing: { category: 'utility', type: 'free_customer_service', billable: false } });
    await store(statusWebhook(d!, 'read', Math.floor(NOW.getTime() / 1000)));
    await processEvents(w.db);
    const costs = await rows('select meta_message_id as w, meta_cost_centipaise as cost, meta_cost_paise as paise, pricing_type from messages order by id');
    expect(costs.map((r) => r.cost)).toEqual([7600, 1150, 0, 7600]);
    expect(costs[1].paise).toBe(12);
    expect(costs[2].pricing_type).toBe('free_customer_service');
  });

  it('with no rate for that category, the cost stays blank, not zero, and says so', async () => {
    const id = await runCampaign('c', 1);
    await send();
    await deliver((await wamids(id))[0]!, { pricing: { category: 'authentication', type: 'regular', billable: true } });
    const warnings: unknown[] = [];
    const log = { warn: (details: unknown) => warnings.push(details), error: () => {}, info: () => {} };
    await processEvents(w.db, new Date(), log as never);
    expect((await rows('select meta_cost_centipaise as cost from messages'))[0].cost).toBeNull();
    expect(warnings).toEqual([expect.objectContaining({ category: 'AUTHENTICATION', country: '91' })]);
  });

  it('a failed message has no cost', async () => {
    const id = await runCampaign('c', 1);
    await send();
    const [a] = await wamids(id);
    await store(statusWebhook(a!, 'failed', 1_800_000_000, { errors: [{ code: 131026, title: 'x' }] }));
    await processEvents(w.db);
    expect((await rows('select meta_cost_centipaise as cost from messages'))[0].cost).toBeNull();
  });
});

describe('9.1 and 9.2 dashboard', () => {
  it('a rebuild equals a count, and running it twice changes nothing', async () => {
    await mixed();
    await refreshDailyStats(w.db, NOW);
    const first = await rows('select * from daily_stats order by date, category');
    await refreshDailyStats(w.db, NOW);
    expect(await rows('select * from daily_stats order by date, category')).toEqual(first);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ queued: 0, sent: 1, delivered: 1, read: 1, failed: 2, blocked: 1 });
    const [{ count }] = await rows('select count(*) from messages');
    const row = first[0];
    expect(row.sent + row.delivered + row.read + row.failed + row.blocked + row.queued).toBe(count);
  });

  it('23:59 and 00:01 India time land on the right days', async () => {
    const id = await runCampaign('edges', 2);
    const [a, b] = await rows('select id from messages where campaign_id = $1 order by id', [id]);
    await w.pool.query(`update messages set queued_at = '2026-10-31T18:29:00Z' where id = $1`, [a.id]);
    await w.pool.query(`update messages set queued_at = '2026-10-31T18:31:00Z' where id = $1`, [b.id]);
    await refreshDailyStats(w.db, NOW);
    const days = await rows(`select to_char(date, 'YYYY-MM-DD') as date, queued from daily_stats order by date`);
    expect(days).toEqual([{ date: '2026-10-31', queued: 1 }, { date: '2026-11-01', queued: 1 }]);
  });

  it('shows the tiles, chart and account box, matching a hand count', async () => {
    const id = await runCampaign('tiles', 4);
    const ids = (await rows('select id from messages where campaign_id = $1 order by id', [id])).map((r) => r.id);
    const when = ['2026-11-01T10:00:00Z', '2026-10-25T10:00:00Z', '2026-10-10T10:00:00Z', '2026-09-01T10:00:00Z'];
    for (let i = 0; i < 4; i++) await w.pool.query('update messages set queued_at = $1 where id = $2', [when[i], ids[i]]);
    await refreshDailyStats(w.db, NOW, true);

    const body = (await call(ASHA, 'GET', `${base()}/dashboard`)).json();
    const p = 95;
    expect(body.tiles).toEqual({
      yesterday: { messages: 1, spendPaise: p },
      last15Days: { messages: 2, spendPaise: 2 * p },
      thisMonth: { messages: 1, spendPaise: p },
      lastMonth: { messages: 2, spendPaise: 2 * p },
    });
    expect(body.chart).toHaveLength(15);
    expect(body.chart.at(-1).date).toBe('2026-11-02');
    expect(body.chart.at(-2)).toMatchObject({ date: '2026-11-01', messages: 1 });
    expect(body.accounts[0]).toMatchObject({ displayPhone: '919800000000', qualityRating: 'GREEN', status: 'active' });
  });

  it('never shows Meta’s cost or margin; another client gets 404', async () => {
    await mixed();
    await refreshDailyStats(w.db, NOW);
    for (const email of [ASHA, MEERA]) {
      const text = (await call(email, 'GET', `${base()}/dashboard`)).body;
      expect(text).not.toMatch(/cost|margin|centipaise|rate/i);
    }
    const report = (await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-11`)).body;
    expect(report).not.toMatch(/cost|margin/i);
    expect((await call(OTHER, 'GET', `${base()}/dashboard`)).statusCode).toBe(404);
  });
});

describe('9.3 month-wise report', () => {
  const COLUMNS = 'Sr No.,Month,Year,User Id,Campaign Name,Total Count,Pending,Failed,Blocked,Sent,Delivered,Not Delivered,DR Not Available,Read Count,Total Unit';

  it('has Dovesoft’s columns, in order, and each row’s totals equal the campaign’s messages', async () => {
    await mixed();
    const body = (await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-11`)).json();
    expect(body.columns.join(',')).toBe(COLUMNS);
    expect(body.items).toEqual([
      {
        'Sr No.': 1,
        Month: 'November',
        Year: 2026,
        'User Id': 'Northwind Labs',
        'Campaign Name': 'Diwali 2026 wave 1',
        'Total Count': 6,
        Pending: 0,
        Failed: 1,
        Blocked: 1,
        Sent: 3,
        Delivered: 1,
        'Not Delivered': 1,
        'DR Not Available': 1,
        'Read Count': 1,
        'Total Unit': '3.80',
      },
    ]);
    const [row] = body.items;
    expect(row.Pending + row.Failed + row['Not Delivered'] + row.Blocked + row.Sent).toBe(row['Total Count']);
    expect(row.Delivered + row['Read Count'] + row['DR Not Available']).toBe(row.Sent);
    expect((await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-10`)).json().items).toEqual([]);
  });

  it('downloads as CSV and as an Excel file that opens with the same headings', async () => {
    await mixed();
    const csv = await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-11&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toBe(COLUMNS);
    expect(csv.body).toContain('Diwali 2026 wave 1');

    const file = await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-11&format=xlsx`);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(file.rawPayload as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;
    expect((sheet.getRow(1).values as unknown[]).slice(1).join(',')).toBe(COLUMNS);
    expect(sheet.getRow(2).getCell(5).value).toBe('Diwali 2026 wave 1');
  });

  it('refuses a bad month, and keeps clients apart', async () => {
    expect((await call(ASHA, 'GET', `${base()}/reports/monthly?month=nope`)).statusCode).toBe(400);
    expect((await call(ASHA, 'GET', `${base()}/reports/monthly?month=2026-13`)).statusCode).toBe(400);
    await mixed();
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/reports/monthly?month=2026-11`)).json().items).toEqual([]);
  });
});

describe('9.4 per-number report', () => {
  it('has Dovesoft’s columns and India-time dates, and every number once', async () => {
    const id = await mixed();
    const res = await call(ASHA, 'GET', `${base()}/campaigns/${id}/report`);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\r\n');
    expect(lines[0]).toBe('sr_no,mobile_no,reason,status,sent_time,delivery_status,delivery_time,read_time,que_time');
    expect(lines).toHaveLength(7);
    const numbers = lines.slice(1).map((l) => l.split(',')[1]);
    expect(new Set(numbers).size).toBe(6);
    expect(lines.find((l) => l.includes('opted_out'))).toContain('blocked');
    expect(lines.find((l) => l.includes('Message undeliverable'))).toContain('failed');
    const read = lines.find((l) => l.includes(',read,'))!.split(',');
    expect(read[3]).toBe('sent');
    expect(read[5]).toBe('read');
    expect(read[8]).toBe('02/11/2026 15:30:00');
  });

  it('formats times as dd/mm/yyyy hh:mm:ss in India time', () => {
    expect(reportTime(new Date('2026-10-31T18:45:07Z'))).toBe('01/11/2026 00:15:07');
    expect(reportTime(null)).toBe('');
  });

  it('downloads a real Excel file, and spans more rows than one batch', async () => {
    const id = await runCampaign('big', 5100);
    const res = await call(ASHA, 'GET', `${base()}/campaigns/${id}/report?format=xlsx`);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
    expect(book.worksheets[0]!.rowCount).toBe(5101);
    const csv = await call(ASHA, 'GET', `${base()}/campaigns/${id}/report`);
    expect(csv.body.trim().split('\r\n')).toHaveLength(5101);
  });

  it('another client gets 404', async () => {
    const id = await runCampaign('c', 1);
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/campaigns/${id}/report`)).statusCode).toBe(404);
    expect((await call(ASHA, 'GET', `${base()}/campaigns/not-a-uuid/report`)).statusCode).toBe(404);
  });
});

describe('9.6 the super admin’s view', () => {
  it('shows billed, Meta’s cost and margin per client, with errors by code; client and staff get 403', async () => {
    await mixed();
    const body = (await call(ADMIN, 'GET', '/api/admin/meta-view?month=2026-11')).json();
    const northwind = body.clients.find((c: { name: string }) => c.name === 'Northwind Labs');
    // Six charged at 95, two refunded. Two delivered messages at 76 paise.
    expect(northwind).toMatchObject({ billedPaise: 4 * 95, metaCostPaise: 2 * 76, marginPaise: 4 * 95 - 2 * 76 });
    expect(northwind.accounts[0]).toMatchObject({ qualityRating: 'GREEN' });
    expect(body.errors.map((e: { code: number }) => e.code).sort()).toEqual([131026, 131049]);
    for (const email of [ASHA, MEERA]) {
      for (const url of ['/api/admin/meta-view', '/api/admin/meta-invoices']) {
        expect((await call(email, 'GET', url)).statusCode).toBe(403);
      }
    }
    expect((await call(ADMIN, 'GET', '/api/admin/meta-view?month=nope')).statusCode).toBe(400);
  });
});

describe('9.7 the check against Meta’s invoice', () => {
  const invoice = (totalPaise: number, perAccount?: object) =>
    call(ADMIN, 'POST', '/api/admin/meta-invoices', { month: '2026-11', totalPaise, ...(perAccount ? { perAccount } : {}) });
  const told = async () => (await rows(`select count(*) from notifications where event = 'billing.meta_invoice_mismatch' and channel = 'email'`))[0].count;

  it('within 0.5% is fine; beyond it alerts and lists the largest differences', async () => {
    await mixed();
    const close = (await invoice(152)).json();
    expect(close).toMatchObject({ recordedPaise: 152, differencePaise: 0, mismatch: false });
    expect(await told()).toBe(0);

    const off = await invoice(200, { 'waba-1': 200, 'waba-unknown': 50 });
    expect(off.statusCode).toBe(201);
    expect(off.json()).toMatchObject({ recordedPaise: 152, differencePaise: 48, differencePercent: 24, mismatch: true });
    expect(off.json().largestDifferences[0]).toEqual({ wabaId: 'waba-unknown', invoicePaise: 50, recordedPaise: 0, differencePaise: 50 });
    expect(off.json().largestDifferences[1]).toMatchObject({ wabaId: 'waba-1', recordedPaise: 152 });
    expect(await told()).toBe(1);
    expect((await call(ADMIN, 'GET', '/api/admin/meta-invoices')).json().items).toHaveLength(2);
  });

  it('a planted wrong rate produces a mismatch', async () => {
    const id = await runCampaign('c', 1);
    await send();
    await deliver((await wamids(id))[0]!);
    await processEvents(w.db);
    await w.pool.query('update messages set meta_cost_centipaise = 100');
    expect((await invoice(76)).json().mismatch).toBe(true);
  });

  it('refuses a bad month or amount', async () => {
    expect((await call(ADMIN, 'POST', '/api/admin/meta-invoices', { month: '2026', totalPaise: 1 })).statusCode).toBe(400);
    expect((await call(ADMIN, 'POST', '/api/admin/meta-invoices', { month: '2026-11', totalPaise: -1 })).statusCode).toBe(400);
  });
});

describe('9.8 credit line usage', () => {
  const told = async (level: number) =>
    (await rows(`select count(*) from notifications where event = 'billing.credit_line_usage' and channel = 'email' and entity_id = $1`, [`2026-11:${level}`]))[0].count;
  const cost = async (centipaise: number) => {
    const id = await runCampaign('c', 1, 9000000000 + Math.floor(Math.random() * 1000));
    await w.pool.query(`update messages set delivered_at = $1, status = 'delivered', meta_cost_centipaise = $2 where campaign_id = $3`, [NOW, centipaise, id]);
  };

  it('crossing 80% tells super admins once, and 95% once more; none without a limit', async () => {
    await cost(8100 * 100);
    await checkCreditLine(w.db, NOW);
    expect(await told(80)).toBe(0);

    await call(ADMIN, 'PUT', '/api/admin/credit-limit', { limitPaise: 10000 });
    await checkCreditLine(w.db, NOW);
    await checkCreditLine(w.db, NOW);
    expect(await told(80)).toBe(1);
    expect(await told(95)).toBe(0);
    expect((await call(ADMIN, 'GET', '/api/admin/meta-view?month=2026-11')).json().creditLine).toEqual({ limitPaise: 10000, usedPaise: 8100, usedPercent: 81 });

    await cost(1500 * 100);
    await checkCreditLine(w.db, NOW);
    expect(await told(95)).toBe(1);
    expect((await call(ASHA, 'PUT', '/api/admin/credit-limit', { limitPaise: 1 })).statusCode).toBe(403);
  });
});
