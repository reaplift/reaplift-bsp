import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { createDb, createPool } from '../src/lib/db.js';
import { MetaClient } from '../src/lib/meta-client.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';
import {
  connectAccount,
  countVariables,
  queueTestMessage,
  readMessage,
  syncTemplates,
} from '../src/modules/messaging/account.js';
import { ORPHAN_TIMEOUT_MS, processEvents } from '../src/modules/messaging/processor.js';
import {
  AccountPacer,
  MAX_SEND_ATTEMPTS,
  reportStuck,
  sendDue,
  STUCK_AFTER_MS,
} from '../src/modules/messaging/sender.js';
import { FakeMeta, HELLO_WORLD, metaError, signWebhook, statusWebhook } from './support/fake-meta.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');

const pool = createPool(url);
const db = createDb(pool);
const KEY = '12345678901234567890123456789012';
const SECRET = 'app-secret';
const TO = '919812345678';

const fake = new FakeMeta();
let meta: MetaClient;
let account: { clientId: string; waAccountId: string };

// The database's clock queues rows; a moment ahead of it, whatever the difference from this machine's clock.
const soon = () => new Date(Date.now() + 1000);
const send = (now = soon(), pacer = new AccountPacer()) =>
  sendDue({ db, meta, encryptionKey: KEY, pacer }, now);
const queue = (to = TO) =>
  queueTestMessage(db, { to, template: 'hello_world', language: 'en_US', variables: [] });
const row = async (id: number) =>
  (await pool.query('select * from messages where id = $1', [id])).rows[0];
const accountRow = async () =>
  (await pool.query('select * from wa_accounts where id = $1', [account.waAccountId])).rows[0];
const later = (ms: number) => new Date(Date.now() + ms);

beforeAll(async () => {
  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
  await migrate(pool, migrationsDir());
  meta = new MetaClient({ baseUrl: await fake.start(), version: 'v26.0', timeoutMs: 500 });
  account = await connectAccount(
    db,
    meta,
    { clientName: 'ReapLift Internal Test', wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' },
    KEY,
  );
});

beforeEach(async () => {
  await pool.query('truncate message_status_events, meta_events, messages restart identity cascade');
  await pool.query(`update wa_accounts set status = 'active', paused_reason = null, send_rate_per_sec = 20`);
  fake.requests.length = 0;
});

afterAll(async () => {
  await fake.stop();
  await pool.end();
});

describe('the database connection', () => {
  it('survives the database dropping an idle connection, as a restart does', async () => {
    const other = createPool(url);
    await other.query('select 1');
    const { rows } = await other.query('select pg_backend_pid() as pid');
    await pool.query('select pg_terminate_backend($1)', [rows[0].pid]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await other.query('select 1 as ok')).rows[0].ok).toBe(1);
    await other.end();
  });
});

describe('4.1 and 4.6 seed-account', () => {
  it('stores the token encrypted, and it decrypts back', async () => {
    const stored: Buffer = (await accountRow()).access_token_enc;
    expect(stored.toString('utf8')).not.toContain('good-token');
    expect(decryptSecret(stored.toString('utf8'), KEY)).toBe('good-token');
    expect((await accountRow()).display_phone).toBe('919800000000');
  });

  it('refuses a bad token and a phone number not on the account, saving nothing', async () => {
    const before = (await pool.query('select count(*) from clients')).rows[0].count;
    const input = { clientName: 'Bad', wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'wrong' };

    await expect(connectAccount(db, meta, input, KEY)).rejects.toThrow(/code 190/);
    await expect(
      connectAccount(db, meta, { ...input, token: 'good-token', phoneNumberId: 'other' }, KEY),
    ).rejects.toThrow(/not on WhatsApp account/);
    await expect(
      connectAccount(db, meta, { ...input, token: 'good-token' }, KEY),
    ).rejects.toThrow(/already connected/);
    expect((await pool.query('select count(*) from clients')).rows[0].count).toBe(before);
  });

  it('copies templates across pages, and running twice leaves the same rows', async () => {
    fake.templates = [
      HELLO_WORLD,
      { ...HELLO_WORLD, id: 't2', name: 'order_update', components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}}' }] },
      { ...HELLO_WORLD, id: 't3', name: 'promo', category: 'MARKETING', status: 'PENDING' },
    ];
    fake.templatePageSize = 2;
    const sync = { id: account.waAccountId, clientId: account.clientId, wabaId: 'waba-1' };

    await syncTemplates(db, meta, sync, 'good-token');
    await syncTemplates(db, meta, sync, 'good-token');

    const { rows } = await pool.query(
      'select name, status, variable_count from templates order by name',
    );
    expect(rows).toEqual([
      { name: 'hello_world', status: 'APPROVED', variable_count: 0 },
      { name: 'order_update', status: 'APPROVED', variable_count: 2 },
      { name: 'promo', status: 'PENDING', variable_count: 0 },
    ]);
    expect(countVariables([{ type: 'BODY', text: '{{1}} and {{1}}' }])).toBe(1);
  });
});

describe('4.7 send-test', () => {
  it('refuses a number with a plus, an unknown or unapproved template, and the wrong variable count', async () => {
    const base = { to: TO, template: 'hello_world', language: 'en_US', variables: [] as string[] };
    await expect(queueTestMessage(db, { ...base, to: '+919812345678' })).rejects.toThrow(/no plus/);
    await expect(queueTestMessage(db, { ...base, template: 'nope' })).rejects.toThrow(/no template/);
    await expect(queueTestMessage(db, { ...base, template: 'promo' })).rejects.toThrow(/not APPROVED/);
    await expect(queueTestMessage(db, { ...base, variables: ['x'] })).rejects.toThrow(/needs 0/);
  });

  it('queues with source cli and returns a numeric id', async () => {
    const id = await queue();
    expect(id).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'queued', source: 'cli', client_id: account.clientId });
  });
});

describe('4.2 and 4.3 sender', () => {
  it('sends with the account token and saves the Meta ID; claims nothing when the queue is empty', async () => {
    const id = await queue();
    expect(await send()).toMatchObject({ sent: 1 });

    const message = await row(id);
    expect(message.status).toBe('sent');
    expect(message.meta_message_id).toMatch(/^wamid\.fake-/);
    expect(message.sent_at).not.toBeNull();
    const [request] = fake.sends();
    expect(request?.path).toBe('/v26.0/phone-1/messages');
    expect(request?.authorization).toBe('Bearer good-token');
    expect(request?.body).toMatchObject({ to: TO, template: { name: 'hello_world' } });

    fake.requests.length = 0;
    expect(await send()).toEqual({ sent: 0, retried: 0, failed: 0, paused: 0 });
    expect(fake.sends()).toHaveLength(0);
  });

  it('429 goes back to the queue for 30 seconds, then succeeds', async () => {
    const id = await queue();
    fake.queueSendResponses({ status: 429 });
    const now = soon();

    expect(await send(now)).toMatchObject({ retried: 1 });
    const waiting = await row(id);
    expect(waiting).toMatchObject({ status: 'queued', attempts: 1 });
    expect(waiting.next_attempt_at.getTime()).toBe(now.getTime() + 30_000);

    expect(await send(now)).toMatchObject({ retried: 0, sent: 0 });
    expect(await send(new Date(now.getTime() + 30_000))).toMatchObject({ sent: 1 });
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2, failure_reason: null });
  });

  it('a timeout is retried', async () => {
    const id = await queue();
    fake.queueSendResponses({ status: 200, delayMs: 800 });

    expect(await send()).toMatchObject({ retried: 1 });
    expect(await row(id)).toMatchObject({ status: 'queued', failure_reason: 'TimeoutError' });
  });

  it('gives up after the attempt limit', async () => {
    const id = await queue();
    fake.queueSendResponses(...Array.from({ length: MAX_SEND_ATTEMPTS }, () => metaError(500, 131000)));

    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) await send(later(3_600_000 * (i + 1)));

    expect(await row(id)).toMatchObject({ status: 'failed', attempts: MAX_SEND_ATTEMPTS, meta_error_code: 131000 });
    fake.requests.length = 0;
    await send(later(10 * 3_600_000));
    expect(fake.sends()).toHaveLength(0);
  });

  it.each([131026, 131049, 131050, 132001])('permanent code %i fails at once and is never retried', async (code) => {
    const id = await queue();
    fake.queueSendResponses(metaError(400, code, 'cannot deliver'));

    expect(await send()).toMatchObject({ failed: 1 });
    expect(await row(id)).toMatchObject({
      status: 'failed',
      meta_error_code: code,
      failure_reason: 'cannot deliver',
      attempts: 1,
    });
    fake.requests.length = 0;
    await send(later(10 * 3_600_000));
    expect(fake.sends()).toHaveLength(0);
  });

  it('190 pauses the account; the message waits, keeps its attempt, and sends after resume', async () => {
    const id = await queue();
    fake.queueSendResponses(metaError(401, 190));

    expect(await send()).toMatchObject({ paused: 1 });
    expect(await accountRow()).toMatchObject({ status: 'paused', paused_reason: 'token invalid' });
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 });

    fake.requests.length = 0;
    expect(await send(later(60_000))).toMatchObject({ sent: 0 });
    expect(fake.sends()).toHaveLength(0);

    await pool.query(`update wa_accounts set status = 'active', paused_reason = null`);
    expect(await send(later(60_000))).toMatchObject({ sent: 1 });
  });

  it('a token that cannot be decrypted pauses the account without calling Meta', async () => {
    const id = await queue();
    await sendDue({ db, meta, encryptionKey: 'abcdefghijklmnopqrstuvwxyz123456', pacer: new AccountPacer() }, soon());

    expect(await accountRow()).toMatchObject({ status: 'paused', paused_reason: 'token cannot be decrypted' });
    expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(fake.sends()).toHaveLength(0);
  });

  it('two workers never send the same row', async () => {
    await pool.query('update wa_accounts set send_rate_per_sec = 100');
    for (let i = 0; i < 40; i++) await queue();

    const results = await Promise.all([send(), send()]);

    expect(results[0]!.sent + results[1]!.sent).toBe(40);
    const sentTo = fake.sends().map((r) => r.body);
    expect(sentTo).toHaveLength(40);
    const { rows } = await pool.query(`select count(distinct meta_message_id) as ids from messages where status = 'sent'`);
    expect(rows[0].ids).toBe(40);
  });

  it('stays within the account rate', async () => {
    await pool.query('update wa_accounts set send_rate_per_sec = 5');
    for (let i = 0; i < 12; i++) await queue();
    const pacer = new AccountPacer();

    while ((await pool.query(`select 1 from messages where status = 'queued'`)).rowCount! > 0) {
      await send(soon(), pacer);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const times = fake.sends().map((r) => r.at);
    expect(times).toHaveLength(12);
    for (const start of times) {
      expect(times.filter((t) => t >= start && t < start + 950).length).toBeLessThanOrEqual(5);
    }
  });

  it('reports a row stuck in sending and never resends it', async () => {
    const id = await queue();
    const now = new Date();
    await pool.query(`update messages set status = 'sending', locked_at = $1 where id = $2`, [
      new Date(now.getTime() - STUCK_AFTER_MS - 1000),
      id,
    ]);

    expect(await reportStuck(db, undefined, now)).toEqual([id]);
    await send(later(3_600_000));
    expect(fake.sends()).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'sending' });
  });
});

describe('4.4 webhook receiver', () => {
  const app = buildApp({
    version: 'test',
    checkDb: async () => true,
    db,
    metaVerifyToken: 'verify',
    metaAppSecret: SECRET,
  });
  afterAll(() => app.close());

  const post = (body: string, signature?: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
      payload: body,
    });
  const stored = async () => (await pool.query('select count(*) from meta_events')).rows[0].count;

  it('stores exactly one row for a valid POST, checking the exact bytes received', async () => {
    const body = '{ "object": "whatsapp_business_account",   "entry": [] }';
    const res = await post(body, signWebhook(body, SECRET));
    expect(res.statusCode).toBe(200);
    expect(await stored()).toBe(1);
  });

  it('stores nothing for an altered or missing signature', async () => {
    const body = statusWebhook('wamid.x', 'read', 1);
    expect((await post(`${body} `, signWebhook(body, SECRET))).statusCode).toBe(401);
    expect((await post(body, signWebhook(body, 'other-secret'))).statusCode).toBe(401);
    expect((await post(body)).statusCode).toBe(401);
    expect(await stored()).toBe(0);
  });

  it('runs the whole flow: queued, sent, delivered, read', async () => {
    const id = await queue();
    await send();
    const { meta_message_id: wamid } = await row(id);
    const base = Math.floor(Date.now() / 1000);

    for (const [status, offset] of [['sent', 0], ['delivered', 3], ['read', 10]] as const) {
      const body = statusWebhook(wamid, status, base + offset, {
        pricing: { billable: true, type: 'regular', category: 'utility' },
      });
      expect((await post(body, signWebhook(body, SECRET))).statusCode).toBe(200);
    }
    expect(await row(id)).toMatchObject({ status: 'sent', delivered_at: null });

    expect(await processEvents(db)).toEqual({ processed: 3, waiting: 0, errored: 0 });

    const message = await row(id);
    expect(message.status).toBe('read');
    expect(message.delivered_at.getTime()).toBe((base + 3) * 1000);
    expect(message.read_at.getTime()).toBe((base + 10) * 1000);
    expect(message).toMatchObject({ pricing_category: 'utility', billable: true });
    const shown = await readMessage(db, id);
    expect(shown?.statuses.map((s) => s.status)).toEqual(['sent', 'delivered', 'read']);
  });
});

describe('4.5 event processor', () => {
  const store = async (body: string) =>
    (await pool.query<{ id: number }>('insert into meta_events (body) values ($1::jsonb) returning id', [body]))
      .rows[0]!.id;
  const eventRow = async (id: number) =>
    (await pool.query('select * from meta_events where id = $1', [id])).rows[0];
  const sentMessage = async () => {
    const id = await queue();
    await send();
    return { id, wamid: (await row(id)).meta_message_id as string };
  };
  const statusCount = async () => (await pool.query('select count(*) from message_status_events')).rows[0].count;

  it('the same webhook three times changes the row once', async () => {
    const { id, wamid } = await sentMessage();
    const body = statusWebhook(wamid, 'delivered', 1_800_000_000);

    for (let i = 0; i < 3; i++) await store(body);
    await processEvents(db);
    const first = await row(id);
    await store(statusWebhook(wamid, 'delivered', 1_800_000_500));
    await processEvents(db);

    expect(await statusCount()).toBe(1);
    expect((await row(id)).delivered_at).toEqual(first.delivered_at);
  });

  it('read never goes back to delivered, and read first fills delivered', async () => {
    const { id, wamid } = await sentMessage();
    await store(statusWebhook(wamid, 'read', 1_800_000_100));
    await store(statusWebhook(wamid, 'delivered', 1_800_000_050));
    await processEvents(db);

    const message = await row(id);
    expect(message.status).toBe('read');
    expect(message.read_at.getTime()).toBe(1_800_000_100_000);
    expect(await statusCount()).toBe(2);
  });

  it('a failed webhook records the code; 131049 is final; failed after delivered is ignored', async () => {
    const first = await sentMessage();
    await store(
      statusWebhook(first.wamid, 'failed', 1_800_000_000, {
        errors: [{ code: 131049, title: 'healthy ecosystem' }],
      }),
    );
    await processEvents(db);
    expect(await row(first.id)).toMatchObject({
      status: 'failed',
      meta_error_code: 131049,
      failure_reason: 'healthy ecosystem',
    });
    fake.requests.length = 0;
    await send(later(10 * 3_600_000));
    expect(fake.sends()).toHaveLength(0);

    const second = await sentMessage();
    await store(statusWebhook(second.wamid, 'delivered', 1_800_000_000));
    await store(statusWebhook(second.wamid, 'failed', 1_800_000_001, { errors: [{ code: 1 }] }));
    await processEvents(db);
    expect(await row(second.id)).toMatchObject({ status: 'delivered' });
  });

  it('a status before the Meta ID is saved waits, works once it is known, and errors after 10 minutes', async () => {
    const { id, wamid } = await sentMessage();
    const early = await store(statusWebhook('wamid.not-yet', 'delivered', 1_800_000_000));
    const lost = await store(statusWebhook('wamid.never', 'delivered', 1_800_000_000));
    const after = await store(statusWebhook(wamid, 'delivered', 1_800_000_000));

    expect(await processEvents(db)).toEqual({ processed: 1, waiting: 2, errored: 0 });
    expect((await eventRow(early)).processed_at).toBeNull();
    expect((await eventRow(after)).processed_at).not.toBeNull();

    const other = await queue();
    await send();
    await pool.query('update messages set meta_message_id = $1 where id = $2', ['wamid.not-yet', other]);
    expect(await processEvents(db)).toEqual({ processed: 1, waiting: 1, errored: 0 });
    expect(await row(other)).toMatchObject({ status: 'delivered' });
    expect(await row(id)).toMatchObject({ status: 'delivered' });

    expect(await processEvents(db, later(ORPHAN_TIMEOUT_MS + 1000))).toEqual({
      processed: 0,
      waiting: 0,
      errored: 1,
    });
    expect((await eventRow(lost)).process_error).toBe('message not found');
  });

  it('replies and other events are marked processed with no action, and stay stored', async () => {
    const reply = await store(
      JSON.stringify({
        entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: TO, text: { body: 'STOP' } }] } }] }],
      }),
    );
    const template = await store(JSON.stringify({ entry: [{ changes: [{ field: 'message_template_status_update', value: {} }] }] }));

    expect(await processEvents(db)).toMatchObject({ processed: 2 });
    expect((await eventRow(reply)).body.entry[0].changes[0].value.messages[0].text.body).toBe('STOP');
    expect((await eventRow(template)).processed_at).not.toBeNull();
  });

  it('a malformed event is marked with its error and does not stop the next one', async () => {
    const { id, wamid } = await sentMessage();
    const bad = await store(statusWebhook(wamid, 'delivered', 0).replace('"timestamp":"0"', '"timestamp":"soon"'));
    await store(statusWebhook(wamid, 'read', 1_800_000_000));

    expect(await processEvents(db)).toEqual({ processed: 1, waiting: 0, errored: 1 });
    expect((await eventRow(bad)).process_error).toMatch(/invalid timestamp/);
    expect(await row(id)).toMatchObject({ status: 'read' });
  });

  it('two processors running together apply each event once', async () => {
    const { wamid } = await sentMessage();
    for (const status of ['sent', 'delivered', 'read']) await store(statusWebhook(wamid, status, 1_800_000_000));

    await Promise.all([processEvents(db), processEvents(db)]);

    expect(await statusCount()).toBe(3);
    expect((await pool.query('select count(*) from meta_events where processed_at is null')).rows[0].count).toBe(0);
  });
});
