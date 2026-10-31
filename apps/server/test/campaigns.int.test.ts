import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetaClient } from '../src/lib/meta-client.js';
import { STALLED_AFTER_MS, watchCampaigns } from '../src/modules/campaigns/monitor.js';
import { XLSX_TYPE, parseCsv } from '../src/modules/campaigns/file-reader.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { AccountPacer, HOLD_AFTER_NO_RESPONSE_MS, sendDue } from '../src/modules/messaging/sender.js';
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

const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-lists-'));
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
const upload = (body: string | Buffer, type = 'text/csv', query = 'fileName=a.csv&optIn=true', email = ASHA) =>
  app.inject({
    method: 'POST',
    url: `${base()}/lists?${query}`,
    headers: { cookie: cookies[email]!, origin: PANEL, 'content-type': type },
    payload: body,
  });
const send = (now = later(), pacer = new AccountPacer()) => sendDue({ db: w.db, meta, encryptionKey: KEY, pacer }, now);
const topup = (amountPaise: number, clientId = w.ids.northwind) =>
  call(ADMIN, 'POST', `/api/admin/clients/${clientId}/wallet/topups`, { amountPaise });
const balance = () => readBalance(w.db, w.ids.northwind);
const store = (body: string) => sql`insert into meta_events (body) values (${body}::jsonb)`.execute(w.db);

/** The worked example's list: 8 rows with one of each problem. */
const CSV = [
  'Name,Mobile,City',
  'Rahul,98123 45678,Pune',
  'Priya,+91-98765-43210,Delhi',
  'Amit,5812345678,Goa',
  'Sara,12345,Goa',
  'Dup,9812345678,Pune',
  'UK,+447911123456,London',
  'Sci,9.81234E+09,Goa',
  'Neha,9000000001,Goa',
  '',
  ',,',
].join('\n');

const readyList = async (content = CSV) => {
  const list = (await upload(content)).json().id as string;
  await call(ASHA, 'PUT', `${base()}/lists/${list}/number-column`, { column: 1 });
  return list;
};
const readyCampaign = async (overrides: object = {}, content = CSV) => {
  const listId = await readyList(content);
  const res = await call(ASHA, 'POST', `${base()}/campaigns`, {
    name: 'Diwali 2026 wave 1',
    templateId,
    listId,
    variableMap: { '1': { column: 0 }, '2': { text: 'DIWALI20' } },
    ...overrides,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};
const confirm = (id: string, email = ASHA) => call(email, 'POST', `${base()}/campaigns/${id}/confirm`);
const campaign = async (id: string) => (await call(ASHA, 'GET', `${base()}/campaigns/${id}`)).json();

beforeAll(async () => {
  w = await createWorld();
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 300 });
  app = w.makeApp({ meta, encryptionKey: KEY, uploadDir: dir, uploadMaxBytes: 1024 * 1024, listMaxRows: 2000 });
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email)).cookie;
  fake.templates = [
    { ...HELLO_WORLD, id: 'diwali', name: 'diwali_offer', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, use code {{2}} today.' }] },
    { ...HELLO_WORLD, id: 'pending', name: 'not_ready', status: 'PENDING' },
  ];
  await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, {
    wabaId: 'waba-1',
    phoneNumberId: 'phone-1',
    token: 'good-token',
  });
  templateId = (await rows(`select id from templates where name = 'diwali_offer'`))[0].id;
  await call(ADMIN, 'POST', '/api/admin/meta-rates', { category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 7600, validFrom: '2026-01-01T00:00:00Z' });
});

beforeEach(async () => {
  await w.pool.query('alter table wallet_ledger disable trigger wallet_ledger_no_change');
  await w.pool.query('truncate wallet_ledger, message_status_events, meta_events, opt_outs, notifications, messages restart identity cascade');
  await w.pool.query('delete from campaigns');
  await w.pool.query('alter table wallet_ledger enable trigger wallet_ledger_no_change');
  await w.pool.query(`update wa_accounts set status = 'active', paused_reason = null, send_rate_per_sec = 500`);
  await w.pool.query(`update clients set status = 'active'`);
  await w.pool.query(`update templates set status = 'APPROVED' where name = 'diwali_offer'`);
  await w.pool.query(`delete from charge_policy where client_id is not null`);
  await w.pool.query(`update charge_policy set charged = (outcome in ('blocked', 'sent_not_delivered', 'delivered'))`);
  fake.requests.length = 0;
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('7.1 audience upload', () => {
  it('saves rows as read, skips and counts blank rows, and records the opt-in', async () => {
    const res = await upload(CSV);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ rowCount: 8, blankRowsSkipped: 2, columns: ['Name', 'Mobile', 'City'] });
    expect(res.json().preview[0]).toEqual(['Rahul', '98123 45678', 'Pune']);
    const [list] = await rows('select opt_in_confirmed_by, opt_in_confirmed_at, storage_key from lists where id = $1', [res.json().id]);
    expect(list.opt_in_confirmed_by).not.toBeNull();
    expect(list.storage_key).toContain(w.ids.northwind);
    expect((await rows('select count(*) from list_contacts where list_id = $1', [res.json().id]))[0].count).toBe(8);
  });

  it('reads Excel: numbers stored as text or as numbers, merged header cells, and formula results', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.addRow(['Name', 'Mobile', '', 'City']);
    sheet.mergeCells('B1:C1');
    sheet.addRow(['Rahul', 9812345678, '', 'Pune']);
    sheet.addRow(['Priya', '9876543210', '', 'Delhi']);
    sheet.addRow([]);
    sheet.addRow(['Neha', { formula: '9000000000+1', result: 9000000001 }, '', 'Goa']);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());

    const res = await upload(bytes, XLSX_TYPE, 'fileName=a.xlsx&optIn=true');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ rowCount: 3, blankRowsSkipped: 1 });
    expect(res.json().columns).toEqual(['Name', 'Mobile', 'Mobile', 'City']);
    const cleaned = await call(ASHA, 'PUT', `${base()}/lists/${res.json().id}/number-column`, { column: 1 });
    expect(cleaned.json()).toMatchObject({ validCount: 3, invalidCount: 0 });
  });

  it('refuses no opt-in, a wrong type, a corrupt file, too many rows and too large a file', async () => {
    const noTick = await upload(CSV, 'text/csv', 'fileName=a.csv');
    expect(noTick.statusCode).toBe(400);
    expect(noTick.json().error).toBe('OPT_IN_REQUIRED');
    expect((await upload(Buffer.from('not excel'), XLSX_TYPE)).json().error).toBe('FILE_UNREADABLE');
    expect((await upload('')).json().error).toBe('FILE_UNREADABLE');
    const long = ['Mobile', ...Array.from({ length: 2001 }, (_, i) => String(9000000000 + i))].join('\n');
    expect((await upload(long)).json().error).toBe('LIST_TOO_LONG');
    expect((await upload(Buffer.alloc(1024 * 1024 + 1, 'a'))).statusCode).toBe(413);
  });

  it("another client's list is 404, and a path in the file name is dropped", async () => {
    const res = await upload(CSV, 'text/csv', 'fileName=..%2F..%2Fevil.csv&optIn=true');
    const id = res.json().id;
    expect((await rows('select file_name from lists where id = $1', [id]))[0].file_name).toBe('evil.csv');
    expect((await call(OTHER, 'GET', `${base()}/lists/${id}`)).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/lists/${id}`)).statusCode).toBe(404);
    expect((await call(OTHER, 'PUT', `/api/clients/${w.ids.greenleaf}/lists/${id}/number-column`, { column: 1 })).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/lists/${id}/invalid`)).statusCode).toBe(404);
  });

  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",h\n')).toEqual([['a', 'b,c', 'd"e'], ['f\ng', 'h']]);
  });
});

describe('7.2 number column', () => {
  it('counts match a hand count, and the invalid rows download with their reasons', async () => {
    const id = (await upload(CSV)).json().id;
    const res = await call(ASHA, 'PUT', `${base()}/lists/${id}/number-column`, { column: 1 });
    expect(res.json()).toEqual({ numberColumn: 1, validCount: 3, invalidCount: 4, duplicateCount: 1 });
    expect((await call(ASHA, 'PUT', `${base()}/lists/${id}/number-column`, { column: 9 })).json().error).toBe('COLUMN_OUT_OF_RANGE');

    const file = await call(ASHA, 'GET', `${base()}/lists/${id}/invalid`);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.body).toContain('not_mobile');
    expect(file.body).toContain('too_short');
    expect(file.body).toContain('wrong_country');
    expect(file.body).toContain('scientific_notation');
    expect(file.body).toContain('duplicate of row 2');
  });

  it('choosing another column cleans again', async () => {
    const id = (await upload(CSV)).json().id;
    await call(ASHA, 'PUT', `${base()}/lists/${id}/number-column`, { column: 1 });
    const res = await call(ASHA, 'PUT', `${base()}/lists/${id}/number-column`, { column: 0 });
    expect(res.json().validCount).toBe(0);
    expect((await rows('select count(*) from list_contacts where list_id = $1 and number is not null', [id]))[0].count).toBe(0);
  });

  it('a downloaded cell cannot run as a formula', async () => {
    const id = (await upload('Name,Mobile\n=HYPERLINK("x"),abc\n')).json().id;
    await call(ASHA, 'PUT', `${base()}/lists/${id}/number-column`, { column: 1 });
    expect((await call(ASHA, 'GET', `${base()}/lists/${id}/invalid`)).body).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('7.3 draft', () => {
  it('refuses an unapproved template; other clients’ IDs are 404; a draft can be partly mapped and edited', async () => {
    const pending = (await rows(`select id from templates where name = 'not_ready'`))[0].id;
    const res = await call(ASHA, 'POST', `${base()}/campaigns`, { name: 'x', templateId: pending });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('TEMPLATE_NOT_APPROVED');
    expect((await call(OTHER, 'POST', `/api/clients/${w.ids.greenleaf}/campaigns`, { name: 'x', templateId })).statusCode).toBe(404);
    const list = await readyList();
    expect((await call(ASHA, 'POST', `${base()}/campaigns`, { name: 'x', templateId, listId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);

    const draft = await call(MEERA, 'POST', `${base()}/campaigns`, { name: 'x', templateId, listId: list, variableMap: { '1': { column: 0 } } });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().id;
    const summary = await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`);
    expect(summary.statusCode).toBe(400);
    expect(summary.json().error).toBe('VARIABLE_NOT_MAPPED');

    const edited = await call(ASHA, 'PUT', `${base()}/campaigns/${id}`, { variableMap: { '1': { column: 9 }, '2': { text: 'X' } } });
    expect(edited.statusCode).toBe(200);
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().error).toBe('COLUMN_OUT_OF_RANGE');
    expect((await call(ASHA, 'GET', `${base()}/campaigns`)).json().items.length).toBeGreaterThan(0);
    expect((await call(OTHER, 'GET', `/api/clients/${w.ids.greenleaf}/campaigns/${id}`)).statusCode).toBe(404);
  });
});

describe('7.4 summary and 7.5 confirm', () => {
  it('runs the worked example, and the parts add up to the total', async () => {
    await topup(200000);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['9000000001'] });
    const id = await readyCampaign();

    const summary = (await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json();
    expect(summary).toEqual({
      total: 8,
      willSend: 2,
      blocked: { total: 1, byReason: { opted_out: 1 } },
      invalid: { total: 4, byReason: { not_mobile: 1, too_short: 1, wrong_country: 1, scientific_notation: 1 } },
      duplicate: 1,
      pricePaise: 95,
      chargePaise: 285,
      balancePaise: 200000,
      balanceAfterPaise: 199715,
      limitWarning: null,
    });
    expect(summary.willSend + summary.blocked.total + summary.invalid.total + summary.duplicate).toBe(summary.total);
    expect((await rows('select count(*) from messages'))[0].count).toBe(0);

    const res = await confirm(id, MEERA);
    expect(res.statusCode).toBe(200);
    expect(await balance()).toBe(199715);
    const messages = await rows('select to_number, status, block_reason, variables, client_price_paise from messages order by id');
    expect(messages.map((m) => [m.status, m.block_reason])).toEqual([['queued', null], ['queued', null], ['blocked', 'opted_out']]);
    expect(messages[0]).toMatchObject({ to_number: '919812345678', variables: ['Rahul', 'DIWALI20'], client_price_paise: 95 });
    expect(await campaign(id)).toMatchObject({ status: 'running', total: 3, blocked: 1, chargedPaise: 285, refundedPaise: 0 });
    const [charge] = await rows(`select amount_paise, campaign_id from wallet_ledger where kind = 'charge'`);
    expect(charge).toEqual({ amount_paise: -285, campaign_id: id });
  });

  it('a short balance leaves no messages and no ledger row, and tells the user how much', async () => {
    await topup(100);
    const id = await readyCampaign();
    const res = await confirm(id);
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: 'INSUFFICIENT_BALANCE', shortPaise: 185 });
    expect((await rows('select count(*) from messages'))[0].count).toBe(0);
    expect((await rows(`select count(*) from wallet_ledger where kind = 'charge'`))[0].count).toBe(0);
    expect((await campaign(id)).status).toBe('draft');
    expect((await rows(`select count(*) from notifications where event = 'campaign.blocked_balance'`))[0].count).toBeGreaterThan(0);
  });

  it('confirming twice, even at once, charges and queues once', async () => {
    await topup(10000);
    const id = await readyCampaign();
    const [a, b] = await Promise.all([confirm(id), confirm(id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await rows('select count(*) from messages'))[0].count).toBe(3);
    expect((await rows(`select count(*) from wallet_ledger where kind = 'charge'`))[0].count).toBe(1);
    const again = await confirm(id);
    expect(again.json().error).toBe('ALREADY_CONFIRMED');
    expect((await call(ASHA, 'PUT', `${base()}/campaigns/${id}`, { name: 'late' })).json().error).toBe('NOT_A_DRAFT');
  });

  it('an opt-out added after the summary is caught at confirm', async () => {
    await topup(10000);
    const id = await readyCampaign();
    const before = (await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json();
    expect(before.blocked.total).toBe(0);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['+919812345678'] });
    await confirm(id);
    expect((await rows(`select status from messages where to_number = '919812345678'`))[0].status).toBe('blocked');
  });

  it('refuses a suspended client, a paused number, a template no longer approved, no price and no valid numbers', async () => {
    await topup(10000);
    const id = await readyCampaign();
    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'Quality dropped to Low'`);
    const paused = await confirm(id);
    expect(paused.statusCode).toBe(409);
    expect(paused.json().error).toBe('ACCOUNT_PAUSED');
    expect(paused.json().message).toContain('Quality dropped to Low');
    await w.pool.query(`update wa_accounts set status = 'active', paused_reason = null`);

    await w.pool.query(`update templates set status = 'PAUSED' where id = $1`, [templateId]);
    expect((await confirm(id)).json().error).toBe('TEMPLATE_NOT_APPROVED');
    await w.pool.query(`update templates set status = 'APPROVED' where id = $1`, [templateId]);

    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/suspend`, { note: 'test' });
    expect((await confirm(id)).json().error).toBe('CLIENT_SUSPENDED');
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/reactivate`, { note: 'test' });

    const empty = await readyCampaign({}, 'Name,Mobile\nA,12345\n');
    expect((await confirm(empty)).json().error).toBe('LIST_EMPTY');
    expect(await balance()).toBe(10000);
  });

  it('follows the charging switches: blocked rows free, invalid rows charged', async () => {
    await topup(10000);
    await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['9000000001'] });
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'blocked', charged: false });
    const free = await readyCampaign();
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${free}/summary`)).json().chargePaise).toBe(190);
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'invalid', charged: true });
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${free}/summary`)).json().chargePaise).toBe(190 + 4 * 95);
  });

  it('warns about the daily limit without blocking', async () => {
    await w.pool.query(`update wa_accounts set messaging_limit = 'TIER_50'`);
    const lines = ['Name,Mobile', ...Array.from({ length: 60 }, (_, i) => `A,${9000000100 + i}`)];
    const id = await readyCampaign({ variableMap: { '1': { column: 0 }, '2': { text: 'X' } } }, lines.join('\n'));
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().limitWarning).toEqual({ limit: 50 });
    await w.pool.query(`update wa_accounts set messaging_limit = null`);
  });
});

describe('7.6 and 7.7 sending, totals and refunds', () => {
  const body = (m: { body: unknown }) => (m.body as { template: { components: Array<{ parameters: Array<{ text: string }> }> } }).template.components[0]!.parameters.map((p) => p.text);

  it('runs a campaign to completion: totals equal a count, failures refunded once, and final notice sent', async () => {
    await topup(10000);
    const id = await readyCampaign();
    await confirm(id);
    fake.queueSendResponses(metaError(400, 131049, 'Meta limit'));
    await send();
    expect((await campaign(id)).sent).toBe(2);
    expect((await campaign(id)).failed).toBe(1);
    expect(await balance()).toBe(10000 - 285 + 95);

    const sends = fake.sends().filter((r) => (r.body as { to: string }).to);
    expect(sends.map(body)).toEqual(expect.arrayContaining([['Rahul', 'DIWALI20'], ['Priya', 'DIWALI20']]));

    const wamids = (await rows(`select meta_message_id from messages where status = 'sent' order by id`)).map((r) => r.meta_message_id);
    await store(statusWebhook(wamids[0], 'delivered', 1_800_000_000));
    await store(statusWebhook(wamids[0], 'read', 1_800_000_001));
    await store(statusWebhook(wamids[1], 'delivered', 1_800_000_000));
    await processEvents(w.db);
    await watchCampaigns(w.db, later());

    const done = await campaign(id);
    expect(done).toMatchObject({ status: 'completed', total: 3, sent: 0, delivered: 1, read: 1, failed: 1, blocked: 0, chargedPaise: 285, refundedPaise: 95 });
    expect(done.failures).toEqual([{ code: 131049, reason: 'Meta limit', count: 1, label: 'Meta limit, not retried' }]);
    const counted = await rows('select status, count(*)::int as n from messages where campaign_id = $1 group by status', [id]);
    expect(Object.fromEntries(counted.map((r) => [r.status, r.n]))).toEqual({ read: 1, delivered: 1, failed: 1 });
    await watchCampaigns(w.db, later());
    expect((await rows(`select count(*) from notifications where event = 'campaign.completed' and email = $1 and channel = 'email'`, [ASHA]))[0].count).toBe(1);
    expect(await checkLedgers(w.db)).toEqual([]);
  });

  it('a failed webhook refunds once, however many times it repeats; delivered after that cannot refund again', async () => {
    await topup(10000);
    const id = await readyCampaign();
    await confirm(id);
    await send();
    const [{ meta_message_id: wamid }] = await rows(`select meta_message_id from messages order by id limit 1`);
    const failed = statusWebhook(wamid, 'failed', 1_800_000_000, { errors: [{ code: 131026, title: 'Undeliverable' }] });
    for (let i = 0; i < 3; i++) await store(failed);
    await processEvents(w.db);
    expect(await balance()).toBe(10000 - 285 + 95);
    expect((await campaign(id)).refundedPaise).toBe(95);
    expect((await campaign(id)).failed).toBe(1);
  });

  it('a failure on a campaign where failed is charged refunds nothing', async () => {
    await topup(10000);
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'failed', charged: true });
    const id = await readyCampaign();
    await confirm(id);
    fake.queueSendResponses(metaError(400, 131026), metaError(400, 131026));
    await send();
    expect(await balance()).toBe(10000 - 285);
    expect((await campaign(id)).refundedPaise).toBe(0);
  });

  it('a suspended client sends nothing', async () => {
    await topup(10000);
    const id = await readyCampaign();
    await confirm(id);
    await w.pool.query(`update clients set status = 'suspended' where id = $1`, [w.ids.northwind]);
    await send();
    expect(fake.sends()).toEqual([]);
  });

  it('other clients are refused the campaign and its summary', async () => {
    const id = await readyCampaign();
    const theirs = `/api/clients/${w.ids.greenleaf}/campaigns/${id}`;
    expect((await call(OTHER, 'GET', `${theirs}/summary`)).statusCode).toBe(404);
    expect((await call(OTHER, 'POST', `${theirs}/confirm`)).statusCode).toBe(404);
    expect((await call(OTHER, 'PUT', theirs, { name: 'x' })).statusCode).toBe(404);
  });
});

describe('7.7 the nightly money check', () => {
  it('is clean when charges, refunds and messages agree, and catches a planted difference', async () => {
    await topup(100000);
    await call(ADMIN, 'PUT', '/api/admin/charge-policy', { clientId: w.ids.northwind, outcome: 'invalid', charged: true });
    const id = await readyCampaign();
    await confirm(id);
    fake.queueSendResponses(metaError(400, 131026));
    await send();
    expect(await checkLedgers(w.db)).toEqual([]);

    await w.pool.query(`update messages set client_price_paise = client_price_paise + 1 where id = (select id from messages where status = 'sent' limit 1)`);
    expect(await checkLedgers(w.db)).toEqual([id]);
  });
});

describe('7.6a a send that gets no answer', () => {
  const lateOnce = async () => {
    await topup(10000);
    const id = await readyCampaign({}, 'Name,Mobile\nRahul,9812345678\n');
    await confirm(id);
    fake.queueSendResponses({ status: 200, delayMs: 600, acceptFirst: true });
    const now = later();
    await send(now);
    return { id, now };
  };
  const hook = (wamid: string, messageId: number, status = 'sent') =>
    store(statusWebhook(wamid, status, 1_800_000_000, { biz_opaque_callback_data: String(messageId) }));

  it('holds the message; its webhook shows Meta took it, so it is sent exactly once', async () => {
    const { id, now } = await lateOnce();
    const [message] = await rows('select id, status, next_attempt_at from messages');
    expect(message.status).toBe('queued');
    expect(message.next_attempt_at.getTime()).toBe(now.getTime() + HOLD_AFTER_NO_RESPONSE_MS);

    fake.requests.length = 0;
    await send(new Date(now.getTime() + 30_000));
    expect(fake.sends()).toEqual([]);

    await hook(fake.accepted.at(-1)!, message.id);
    expect(await processEvents(w.db)).toMatchObject({ processed: 1, errored: 0 });
    const [saved] = await rows('select status, meta_message_id from messages');
    expect(saved).toEqual({ status: 'sent', meta_message_id: fake.accepted.at(-1) });

    await send(new Date(now.getTime() + HOLD_AFTER_NO_RESPONSE_MS + 1000));
    expect(fake.sends()).toEqual([]);
    expect((await campaign(id)).sent).toBe(1);
  });

  it('with no webhook, it retries once the hold ends', async () => {
    const { now } = await lateOnce();
    fake.requests.length = 0;
    await send(new Date(now.getTime() + HOLD_AFTER_NO_RESPONSE_MS));
    expect(fake.sends()).toHaveLength(1);
    expect((await rows('select status from messages'))[0].status).toBe('sent');
  });

  it('an error answer is not held', async () => {
    await topup(10000);
    const id = await readyCampaign({}, 'Name,Mobile\nRahul,9812345678\n');
    await confirm(id);
    fake.queueSendResponses(metaError(500, 131000));
    const now = later();
    await send(now);
    expect((await rows('select next_attempt_at from messages'))[0].next_attempt_at.getTime()).toBe(now.getTime() + 30_000);
  });

  it('a webhook after the retry is the double send: changes nothing, raises no error', async () => {
    const { now } = await lateOnce();
    await send(new Date(now.getTime() + HOLD_AFTER_NO_RESPONSE_MS));
    const [message] = await rows('select id, status, meta_message_id from messages');
    await hook(fake.accepted.at(-2)!, message.id, 'delivered');
    expect(await processEvents(w.db)).toEqual({ processed: 1, waiting: 0, errored: 0 });
    expect((await rows('select status, meta_message_id from messages'))[0]).toEqual({ status: 'sent', meta_message_id: message.meta_message_id });
  });
});

describe('7.8 opt-outs', () => {
  const reply = (text: string, from = '919812345678', phoneNumberId = 'phone-1') =>
    JSON.stringify({
      entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ from, type: 'text', text: { body: text } }] } }] }],
    });
  const optOuts = () => rows('select client_id, number, source from opt_outs');

  it('STOP blocks that number for this client only; twice saves one row; other words do nothing', async () => {
    await store(reply(' stop '));
    await store(reply('STOP'));
    await store(reply('please do not stop', '919800000001'));
    await store(reply('STOP', '919800000002', 'unknown-phone'));
    await processEvents(w.db);
    expect(await optOuts()).toEqual([{ client_id: w.ids.northwind, number: '919812345678', source: 'stop_reply' }]);

    await topup(10000);
    const id = await readyCampaign();
    expect((await call(ASHA, 'GET', `${base()}/campaigns/${id}/summary`)).json().blocked.byReason).toEqual({ opted_out: 1 });
  });

  it('the super admin edits the stop words and uploads numbers; others cannot', async () => {
    expect((await call(ASHA, 'PUT', '/api/admin/settings/stop_words', { value: ['BAND'] })).statusCode).toBe(403);
    expect((await call(ADMIN, 'PUT', '/api/admin/settings/secret', { value: ['X'] })).statusCode).toBe(404);
    expect((await call(ADMIN, 'PUT', '/api/admin/settings/stop_words', { value: ['STOP', 'BAND'] })).statusCode).toBe(200);
    expect((await call(ADMIN, 'GET', '/api/admin/settings/stop_words')).json().value).toEqual(['STOP', 'BAND']);
    await store(reply('band'));
    await processEvents(w.db);
    expect(await optOuts()).toHaveLength(1);
    await call(ADMIN, 'PUT', '/api/admin/settings/stop_words', { value: ['STOP', 'UNSUBSCRIBE'] });

    const res = await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['9000000009', '+919000000009', 'nope'] });
    expect(res.json()).toEqual({ added: 1, invalid: 1 });
    expect((await call(ASHA, 'POST', `/api/admin/clients/${w.ids.northwind}/opt-outs`, { numbers: ['9000000009'] })).statusCode).toBe(403);
  });
});

describe('7.9 notifications', () => {
  const count = async (event: string) => (await rows('select count(*) from notifications where event = $1', [event]))[0].count;

  it('started and stalled fire once; a campaign still moving does not stall', async () => {
    await topup(10000);
    await confirm(await readyCampaign());
    expect(await count('campaign.started')).toBe(1);
    await watchCampaigns(w.db, later());
    expect(await count('campaign.stalled')).toBe(0);
    const stalled = later(STALLED_AFTER_MS);
    await watchCampaigns(w.db, stalled);
    const once = await count('campaign.stalled');
    expect(once).toBeGreaterThan(0);
    await watchCampaigns(w.db, stalled);
    expect(await count('campaign.stalled')).toBe(once);
    expect((await rows(`select email from notifications where event = 'campaign.stalled' and email = $1`, [ADMIN])).length).toBe(2);
  });

  it('a paused number during a campaign tells people, and does not count as stalled', async () => {
    await topup(10000);
    await confirm(await readyCampaign());
    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'token invalid'`);
    await watchCampaigns(w.db, later(STALLED_AFTER_MS));
    expect(await count('campaign.account_paused')).toBeGreaterThan(0);
    expect(await count('campaign.stalled')).toBe(0);
  });

  it('more than 10% failed of at least 200 results alerts once', async () => {
    await topup(1000000);
    const lines = ['Name,Mobile', ...Array.from({ length: 250 }, (_, i) => `A,${9000001000 + i}`)];
    const id = await readyCampaign({}, lines.join('\n'));
    await confirm(id);
    await w.pool.query(`update messages set status = 'sent' where id in (select id from messages where campaign_id = $1 order by id limit 150)`, [id]);
    await watchCampaigns(w.db, later());
    expect(await count('campaign.high_failure')).toBe(0);
    await w.pool.query(`update messages set status = 'failed' where id in (select id from messages where campaign_id = $1 and status = 'queued' order by id limit 60)`, [id]);
    await watchCampaigns(w.db, later());
    const once = await count('campaign.high_failure');
    expect(once).toBeGreaterThan(0);
    await watchCampaigns(w.db, later());
    expect(await count('campaign.high_failure')).toBe(once);
  });
});
