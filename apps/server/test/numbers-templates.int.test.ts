import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret } from '../src/lib/crypto.js';
import { MetaClient } from '../src/lib/meta-client.js';
import { processEvents } from '../src/modules/messaging/processor.js';
import { syncQuality } from '../src/modules/messaging/quality.js';
import { AccountPacer, sendDue } from '../src/modules/messaging/sender.js';
import { listApprovedTemplates } from '../src/modules/templates/routes.js';
import { syncTemplateStatuses } from '../src/modules/templates/status.js';
import { SUBMIT_RETRY_MS, submitDue } from '../src/modules/templates/submission.js';
import { FakeMeta, HELLO_WORLD, metaError, templateWebhook } from './support/fake-meta.js';
import { createWorld, PANEL } from './support/world.js';

const KEY = 'abcdefghijklmnopqrstuvwxyz123456';
const fake = new FakeMeta();
let w: Awaited<ReturnType<typeof createWorld>>;
let app: ReturnType<Awaited<ReturnType<typeof createWorld>>['makeApp']>;
let meta: MetaClient;
const cookies: Record<string, string> = {};
const ADMIN = 'ravi@reaplift.com';
const ASHA = 'ops@northwind.com';
const MEERA = 'meera@reaplift.com';
const OTHER = 'sales@greenleaf.in';

const call = (email: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: cookies[email]!, origin: PANEL },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
// Ahead of the world's clock, which stamps the rows the routes write.
const later = () => new Date('2026-11-03T00:00:00Z');
const deps = () => ({ db: w.db, meta, encryptionKey: KEY });
const submit = (now = later()) => submitDue(deps(), now);
const rowsOf = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;

const connect = async (clientId: string, phoneNumberId = 'phone-1') => {
  const res = await call(ADMIN, 'POST', `/api/admin/clients/${clientId}/wa-accounts`, {
    wabaId: 'waba-1',
    phoneNumberId,
    token: 'good-token',
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
};
const draft = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  waAccountId: accountId,
  name: 'diwali_offer_2026',
  language: 'en_US',
  category: 'UTILITY',
  components: [
    {
      type: 'BODY',
      text: 'Hi {{1}}, flat 20% off on all orders till Sunday. Use code {{2}} now.',
      example: { body_text: [['Rahul', 'DIWALI20']] },
    },
  ],
  ...overrides,
});
const url = (id: string, rest = '') => `/api/clients/${w.ids.northwind}/templates${id ? `/${id}` : ''}${rest}`;
const asEdit = (body: Record<string, unknown>) => {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'waAccountId'));
};
const store = (body: string) => sql`insert into meta_events (body) values (${body}::jsonb)`.execute(w.db);
const createApproved = async (accountId: string, name: string) => {
  const created = await call(ASHA, 'POST', url(''), draft(accountId, { name, category: 'MARKETING' }));
  await call(ASHA, 'POST', url(created.json().id, '/submit'));
  await submit();
  const metaId = (await call(ASHA, 'GET', url(created.json().id))).json().metaTemplateId;
  await store(templateWebhook(metaId, 'APPROVED'));
  await processEvents(w.db);
  return { id: created.json().id as string, metaId: metaId as string };
};

beforeAll(async () => {
  w = await createWorld();
  const base = await fake.start();
  meta = new MetaClient({ baseUrl: base, version: 'v26.0', timeoutMs: 500 });
  app = w.makeApp({ meta, encryptionKey: KEY });
  for (const email of [ADMIN, ASHA, MEERA, OTHER]) cookies[email] = (await w.login(email)).cookie;
});

beforeEach(async () => {
  await w.pool.query('truncate message_status_events, meta_events, messages, notifications, audit_logs restart identity cascade');
  await w.pool.query('delete from templates');
  await w.pool.query('delete from wa_accounts');
  fake.requests.length = 0;
  fake.templates = [HELLO_WORLD];
  fake.templateResponses = [];
  fake.creditResponses = [];
  fake.registerResponses = [];
  fake.quality = 'GREEN';
  fake.validToken = 'good-token';
});

afterAll(async () => {
  await app.close();
  await fake.stop();
  await w.close();
});

describe('5.1 manual connection and account box', () => {
  it('connects a number for an existing client, with the token encrypted and never returned', async () => {
    const res = await call(ADMIN, 'POST', `/api/admin/clients/${w.ids.northwind}/wa-accounts`, {
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      token: 'good-token',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('good-token');
    expect(res.body).not.toContain('access_token');
    expect(res.json()).toMatchObject({
      clientId: w.ids.northwind,
      displayPhone: '919800000000',
      metaPayer: 'reaplift_card',
      onboardedVia: 'manual',
      qualityRating: 'GREEN',
      messagingLimit: 'TIER_2K',
      status: 'active',
    });
    const [row] = await rowsOf('select access_token_enc, connected_by, connected_at from wa_accounts');
    expect(row.access_token_enc.toString()).not.toContain('good-token');
    expect(row.connected_by).not.toBeNull();

    const list = await call(ASHA, 'GET', `/api/clients/${w.ids.northwind}/wa-accounts`);
    expect(list.json().items).toHaveLength(1);
    expect(list.body).not.toContain('good-token');
    expect((await rowsOf(`select count(*) from templates where name = 'hello_world'`))[0].count).toBe(1);
    expect((await rowsOf(`select count(*) from audit_logs where action = 'wa_account.connected'`))[0].count).toBe(1);
  });

  it('refuses bad IDs or a bad token, saving nothing and creating no client', async () => {
    const before = (await rowsOf('select count(*) from clients'))[0].count;
    const path = `/api/admin/clients/${w.ids.northwind}/wa-accounts`;
    const bad = await call(ADMIN, 'POST', path, { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'wrong' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('META_REFUSED');
    const other = await call(ADMIN, 'POST', path, { wabaId: 'waba-1', phoneNumberId: 'other', token: 'good-token' });
    expect(other.statusCode).toBe(400);
    expect((await rowsOf('select count(*) from wa_accounts'))[0].count).toBe(0);
    expect((await rowsOf('select count(*) from clients'))[0].count).toBe(before);
  });

  it('only a super admin connects; an unknown client is 404; without a real key it answers 503', async () => {
    const body = { wabaId: 'waba-1', phoneNumberId: 'phone-1', token: 'good-token' };
    const path = `/api/admin/clients/${w.ids.northwind}/wa-accounts`;
    expect((await call(ASHA, 'POST', path, body)).statusCode).toBe(403);
    expect((await call(MEERA, 'POST', path, body)).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', '/api/admin/clients/00000000-0000-4000-8000-000000000000/wa-accounts', body)).statusCode).toBe(404);

    const unconfigured = w.makeApp();
    const res = await unconfigured.inject({ method: 'POST', url: path, headers: { cookie: cookies[ADMIN]!, origin: PANEL }, payload: body });
    expect(res.statusCode).toBe(503);
    await unconfigured.close();
  });
});

describe("5.3 and 5.4 a template's life", () => {
  it('runs the worked example: fails locally, submits, is rejected, is fixed, is approved', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId));
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json()).toMatchObject({ status: 'DRAFT', variableCount: 2 });

    // Step 3: a local failure makes no call to Meta.
    fake.requests.length = 0;
    const failed = await call(ASHA, 'POST', url(id, '/submit'));
    expect(failed.statusCode).toBe(422);
    expect(failed.json().status).toBe('VALIDATION_FAILED');
    expect(failed.json().validationErrors[0]).toMatchObject({ rule: 'category_fit' });
    await submit();
    expect(fake.requests).toHaveLength(0);

    // Step 4: fixed, it goes to Meta in the background.
    const edited = await call(ASHA, 'PUT', url(id), asEdit(draft(accountId, { category: 'MARKETING' })));
    expect(edited.json()).toMatchObject({ status: 'DRAFT', validationErrors: null });
    const accepted = await call(ASHA, 'POST', url(id, '/submit'));
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().status).toBe('SUBMITTING');
    await submit();
    const pending = (await call(ASHA, 'GET', url(id))).json();
    expect(pending.status).toBe('PENDING');
    expect(pending.metaTemplateId).toMatch(/^tmpl-/);
    expect(fake.requests.at(-1)?.authorization).toBe('Bearer good-token');

    // Step 5: rejected with Meta's words and our explanation; Asha and Meera are told.
    await store(
      templateWebhook(pending.metaTemplateId, 'REJECTED', {
        reason: 'INVALID_FORMAT',
        rejection_info: { reason: 'bad', recommendation: 'Remove the extra spaces.' },
      }),
    );
    await processEvents(w.db);
    const rejected = (await call(ASHA, 'GET', url(id))).json();
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'INVALID_FORMAT',
      metaRecommendation: 'Remove the extra spaces.',
    });
    expect(rejected.rejectionExplanation).toMatch(/format/);
    const told = await rowsOf(`select email from notifications where event = 'template.rejected' and channel = 'email' order by email`);
    expect(told.map((r) => r.email)).toEqual(['meera@reaplift.com', 'ops@northwind.com']);

    // Step 6: edited and resubmitted, it goes to Meta as an edit, under the same ID.
    expect((await call(ASHA, 'POST', url(id, '/submit'))).statusCode).toBe(409);
    await call(ASHA, 'PUT', url(id), asEdit(draft(accountId, { category: 'MARKETING' })));
    expect((await call(MEERA, 'POST', url(id, '/submit'))).statusCode).toBe(202);
    fake.requests.length = 0;
    await submit();
    expect(fake.requests[0]?.path).toBe(`/v26.0/${pending.metaTemplateId}`);
    await store(templateWebhook(pending.metaTemplateId, 'APPROVED'));
    await processEvents(w.db);
    expect((await call(ASHA, 'GET', url(id))).json().status).toBe('APPROVED');
    expect((await rowsOf(`select count(*) from notifications where event = 'template.approved' and channel = 'panel'`))[0].count).toBe(2);
    const approved = await listApprovedTemplates(w.db, { clientId: w.ids.northwind });
    expect(approved.map((t) => t.name)).toContain('diwali_offer_2026');
  });

  it('a webhook and a sync for the same change update the row once; the same webhook twice changes nothing', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const { id, metaId } = await createApproved(accountId, 'promo_one');

    await store(templateWebhook(metaId, 'APPROVED'));
    await processEvents(w.db);
    fake.templates.find((t) => t.id === metaId)!.status = 'APPROVED';
    await syncTemplateStatuses(deps());
    const row = (await call(ASHA, 'GET', url(id))).json();
    expect(row.status).toBe('APPROVED');
    expect((await rowsOf(`select count(*) from notifications where event = 'template.approved' and channel = 'email'`))[0].count).toBe(2);
  });

  it('the sync catches a change no webhook reported, and notifies', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    await call(ASHA, 'POST', url(created.json().id, '/submit'));
    await submit();
    const metaId = (await call(ASHA, 'GET', url(created.json().id))).json().metaTemplateId;
    Object.assign(fake.templates.find((t) => t.id === metaId)!, { status: 'REJECTED', rejected_reason: 'SCAM' });

    await syncTemplateStatuses(deps());

    expect((await call(ASHA, 'GET', url(created.json().id))).json()).toMatchObject({ status: 'REJECTED', rejectionReason: 'SCAM' });
    expect((await rowsOf(`select count(*) from notifications where event = 'template.rejected'`))[0].count).toBeGreaterThan(0);
  });

  it('the sync leaves a draft being fixed alone, and copies in templates made at Meta', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    const id = created.json().id;
    await call(ASHA, 'POST', url(id, '/submit'));
    await submit();
    const metaId = (await call(ASHA, 'GET', url(id))).json().metaTemplateId;
    await store(templateWebhook(metaId, 'REJECTED'));
    await processEvents(w.db);
    fake.templates.find((t) => t.id === metaId)!.status = 'REJECTED';
    await call(ASHA, 'PUT', url(id), asEdit(draft(accountId, { category: 'MARKETING', components: [{ type: 'BODY', text: 'New words for you, friend.' }] })));
    fake.templates.push({ ...HELLO_WORLD, id: 'at-meta', name: 'made_at_meta' });

    await syncTemplateStatuses(deps());

    const row = (await call(ASHA, 'GET', url(id))).json();
    expect(row.status).toBe('DRAFT');
    expect(row.components[0].text).toBe('New words for you, friend.');
    expect((await rowsOf(`select status from templates where name = 'made_at_meta'`))[0].status).toBe('APPROVED');
  });

  it('a refusal from Meta rejects at once; a temporary error waits and tries again; an account error pauses', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const make = async (name: string) => {
      const res = await call(ASHA, 'POST', url(''), draft(accountId, { name, category: 'MARKETING' }));
      await call(ASHA, 'POST', url(res.json().id, '/submit'));
      return res.json().id as string;
    };

    const refused = await make('refused_one');
    fake.templateResponses = [metaError(400, 100, 'Name already exists')];
    await submit();
    expect((await call(ASHA, 'GET', url(refused))).json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Name already exists',
      rejectionExplanation: 'Name already exists',
    });

    const busy = await make('busy_one');
    fake.templateResponses = [metaError(500, 131000)];
    const now = later();
    await submitDue(deps(), now);
    expect((await call(ASHA, 'GET', url(busy))).json().status).toBe('SUBMITTING');
    fake.requests.length = 0;
    await submitDue(deps(), now);
    expect(fake.requests).toHaveLength(0);
    await submitDue(deps(), new Date(now.getTime() + SUBMIT_RETRY_MS));
    expect((await call(ASHA, 'GET', url(busy))).json().status).toBe('PENDING');

    const blocked = await make('blocked_one');
    fake.templateResponses = [metaError(401, 190, 'bad token')];
    await submit();
    expect((await call(ASHA, 'GET', url(blocked))).json().status).toBe('SUBMITTING');
    expect((await rowsOf('select status from wa_accounts'))[0].status).toBe('paused');
  });

  it('two workers submit a template once', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    await call(ASHA, 'POST', url(created.json().id, '/submit'));
    fake.requests.length = 0;
    await Promise.all([submit(), submit()]);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('approved templates cannot be edited; a copy is a new draft; a taken name is refused', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const { id } = await createApproved(accountId, 'promo_two');
    const edit = await call(ASHA, 'PUT', url(id), asEdit(draft(accountId, { name: 'promo_two', category: 'MARKETING' })));
    expect(edit.statusCode).toBe(409);
    expect((await call(ASHA, 'POST', url(id, '/submit'))).statusCode).toBe(409);

    const copy = await call(ASHA, 'POST', url(id, '/copy'), { name: 'promo_three' });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ status: 'DRAFT', metaTemplateId: null, name: 'promo_three' });
    expect((await call(ASHA, 'POST', url(id, '/copy'), { name: 'promo_three' })).statusCode).toBe(409);
    expect((await call(ASHA, 'POST', url(''), draft(accountId, { name: 'promo_three' }))).statusCode).toBe(409);
  });

  it('once Meta has a template, its name and language cannot change', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    const id = created.json().id;
    await call(ASHA, 'POST', url(id, '/submit'));
    await submit();
    await store(templateWebhook((await call(ASHA, 'GET', url(id))).json().metaTemplateId, 'REJECTED'));
    await processEvents(w.db);
    const res = await call(ASHA, 'PUT', url(id), asEdit(draft(accountId, { name: 'other_name', category: 'MARKETING' })));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NAME_LOCKED');
  });

  it('keeps clients apart, and refuses bad input', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ASHA, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    const id = created.json().id;
    const theirs = `/api/clients/${w.ids.greenleaf}/templates`;

    // Another client's user, and another client's account or template used under one's own client.
    expect((await call(ASHA, 'GET', theirs)).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', url(id))).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', `${theirs}/${id}`)).statusCode).toBe(404);
    expect((await call(OTHER, 'POST', theirs, draft(accountId))).statusCode).toBe(404);
    expect((await call(OTHER, 'GET', theirs)).json().items).toEqual([]);
    expect((await call(ASHA, 'GET', url('not-a-uuid'))).statusCode).toBe(404);

    expect((await call(ASHA, 'POST', url(''), { name: 'x' })).statusCode).toBe(400);
    expect((await call(ASHA, 'POST', url(''), draft(accountId, { extra: 1 }))).statusCode).toBe(400);
  });

  it('listApprovedTemplates leaves out other statuses and paused accounts', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    await createApproved(accountId, 'promo_four');
    await call(ASHA, 'POST', url(''), draft(accountId, { name: 'still_draft' }));
    const names = async () => (await listApprovedTemplates(w.db, { clientId: w.ids.northwind })).map((t) => t.name);
    expect(await names()).toContain('promo_four');
    expect(await names()).not.toContain('still_draft');
    expect(await listApprovedTemplates(w.db, { clientId: w.ids.greenleaf })).toEqual([]);

    await w.pool.query(`update wa_accounts set status = 'paused'`);
    expect(await names()).toEqual([]);
  });

  it('a paused template notifies, and a re-enabled one is approved again', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const { id, metaId } = await createApproved(accountId, 'promo_five');
    await store(templateWebhook(metaId, 'PAUSED'));
    await processEvents(w.db);
    expect((await call(ASHA, 'GET', url(id))).json().status).toBe('PAUSED');
    expect((await rowsOf(`select count(*) from notifications where event = 'template.paused_or_disabled' and channel = 'email'`))[0].count).toBe(3);
    await store(templateWebhook(metaId, 'REINSTATED'));
    await processEvents(w.db);
    expect((await call(ASHA, 'GET', url(id))).json().status).toBe('APPROVED');
  });

  it('a warning event, and a webhook for an unknown template, change nothing', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const { id, metaId } = await createApproved(accountId, 'promo_six');
    await store(templateWebhook(metaId, 'FLAGGED'));
    await store(templateWebhook('not-ours', 'APPROVED'));
    expect(await processEvents(w.db)).toMatchObject({ errored: 0, waiting: 0 });
    expect((await call(ASHA, 'GET', url(id))).json().status).toBe('APPROVED');
  });
});

describe('5.5 quality and limit', () => {
  const account = async () => (await rowsOf('select * from wa_accounts'))[0];

  it('Medium to Low pauses and tells everyone; back to Medium does not resume; resume needs a super admin', async () => {
    const { id } = await connect(w.ids.northwind);
    await w.pool.query('truncate notifications');
    fake.quality = 'YELLOW';
    await syncQuality(deps());
    expect(await account()).toMatchObject({ quality_rating: 'YELLOW', status: 'active', messaging_limit: 'TIER_2K' });

    fake.quality = 'RED';
    await syncQuality(deps());
    expect(await account()).toMatchObject({ status: 'paused', paused_reason: 'Quality dropped to Low' });
    const told = await rowsOf(`select email from notifications where event = 'account.paused' and channel = 'email' order by email`);
    expect(told.map((r) => r.email)).toEqual([ 'meera@reaplift.com', 'ops@northwind.com', 'ravi@reaplift.com']);

    fake.quality = 'YELLOW';
    await syncQuality(deps());
    expect((await account()).status).toBe('paused');

    expect((await call(ASHA, 'POST', `/api/admin/wa-accounts/${id}/resume`)).statusCode).toBe(403);
    expect((await call(MEERA, 'POST', `/api/admin/wa-accounts/${id}/resume`)).statusCode).toBe(403);
    const resumed = await call(ADMIN, 'POST', `/api/admin/wa-accounts/${id}/resume`);
    expect(resumed.statusCode).toBe(200);
    expect(await account()).toMatchObject({ status: 'active', paused_reason: null });
    const audit = await rowsOf(`select details from audit_logs where action = 'wa_account.resumed'`);
    expect(audit[0].details).toEqual({ pausedReason: 'Quality dropped to Low' });
    expect((await rowsOf(`select count(*) from notifications where event = 'account.resumed' and channel = 'email'`))[0].count).toBe(2);
    expect((await call(ADMIN, 'POST', `/api/admin/wa-accounts/${id}/resume`)).statusCode).toBe(409);
  });

  it('a resumed account still at Low is not paused again by the next sync', async () => {
    const { id } = await connect(w.ids.northwind);
    fake.quality = 'RED';
    await syncQuality(deps());
    await call(ADMIN, 'POST', `/api/admin/wa-accounts/${id}/resume`);
    await syncQuality(deps());
    expect((await account()).status).toBe('active');
  });

  it('stops sending while paused for quality', async () => {
    const { id } = await connect(w.ids.northwind);
    const template = (await rowsOf(`select id from templates where name = 'hello_world'`))[0].id;
    await w.pool.query(
      `insert into messages (client_id, wa_account_id, template_id, to_number, source) values ($1, $2, $3, '919812345678', 'cli')`,
      [w.ids.northwind, id, template],
    );
    fake.quality = 'RED';
    await syncQuality(deps());
    fake.requests.length = 0;
    await sendDue({ ...deps(), pacer: new AccountPacer() }, later());
    expect(fake.requests).toHaveLength(0);
  });

  it('a limit webhook updates the number; an error reading quality changes nothing', async () => {
    await connect(w.ids.northwind);
    await store(
      JSON.stringify({
        entry: [{ id: 'waba-1', changes: [{ field: 'phone_number_quality_update', value: { event: 'THROUGHPUT_UPGRADE', max_daily_conversations_per_business: 'TIER_10K' } }] }],
      }),
    );
    await processEvents(w.db);
    expect((await account()).messaging_limit).toBe('TIER_10K');

    fake.validToken = 'rotated';
    fake.quality = 'RED';
    await syncQuality(deps());
    expect((await account()).status).toBe('active');
  });
});

describe('5.6 notifications', () => {
  it('account.connected tells client users, assigned staff and super admins', async () => {
    await connect(w.ids.northwind);
    const told = await rowsOf(`select email, channel from notifications where event = 'account.connected' order by email, channel`);
    expect(told.filter((r) => r.channel === 'email').map((r) => r.email)).toEqual([
      'meera@reaplift.com',
      'ops@northwind.com',
      'ravi@reaplift.com',
    ]);
    expect(told.filter((r) => r.channel === 'panel')).toHaveLength(3);
  });

  it('an account paused by a send error tells everyone once', async () => {
    const { id } = await connect(w.ids.northwind);
    const template = (await rowsOf(`select id from templates where name = 'hello_world'`))[0].id;
    for (let i = 0; i < 2; i++) {
      await w.pool.query(
        `insert into messages (client_id, wa_account_id, template_id, to_number, source) values ($1, $2, $3, '919812345678', 'cli')`,
        [w.ids.northwind, id, template],
      );
    }
    fake.queueSendResponses(metaError(401, 190), metaError(401, 190));
    await sendDue({ ...deps(), pacer: new AccountPacer() }, later());
    expect((await rowsOf(`select count(*) from notifications where event = 'account.paused' and channel = 'email'`))[0].count).toBe(3);
  });

  it('a submitter who is neither the client nor its staff is told too', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const created = await call(ADMIN, 'POST', url(''), draft(accountId, { category: 'MARKETING' }));
    await call(ADMIN, 'POST', url(created.json().id, '/submit'));
    await submit();
    await store(templateWebhook((await call(ADMIN, 'GET', url(created.json().id))).json().metaTemplateId, 'APPROVED'));
    await processEvents(w.db);
    const told = await rowsOf(`select email from notifications where event = 'template.approved' and channel = 'email' order by email`);
    expect(told.map((r) => r.email)).toEqual(['meera@reaplift.com', 'ops@northwind.com', 'ravi@reaplift.com']);
  });
});

describe('5.2 Embedded Signup and credit-line sharing', () => {
  const signupApp = (extra = {}) =>
    w.makeApp({
      meta,
      encryptionKey: KEY,
      metaAppId: 'app-1',
      metaAppSecret: 'app-secret',
      metaSystemToken: 'system-token',
      metaCreditLineId: 'line-1',
      ...extra,
    });
  const signup = async (server: ReturnType<typeof signupApp>, email = ASHA, code = 'good-code') =>
    server.inject({
      method: 'POST',
      url: `/api/clients/${w.ids.northwind}/wa-accounts/embedded-signup`,
      headers: { cookie: cookies[email]!, origin: PANEL },
      payload: { code, wabaId: 'waba-1', phoneNumberId: 'phone-1' },
    });
  const paths = () => fake.requests.filter((r) => r.method === 'POST').map((r) => r.path.split('/').pop());

  it('a client connects its own number: exchange, subscribe, share, register, in that order', async () => {
    const server = signupApp();
    const res = await signup(server);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      metaPayer: 'reaplift_credit_line',
      onboardedVia: 'embedded_signup',
      status: 'active',
      qualityRating: 'GREEN',
    });
    expect(res.body).not.toContain('business-token');
    expect(paths()).toEqual(['subscribed_apps', 'whatsapp_credit_sharing_and_attach', 'register']);
    const credit = fake.requests.find((r) => r.path.endsWith('/whatsapp_credit_sharing_and_attach'));
    expect(credit?.authorization).toBe('Bearer system-token');
    const register = fake.requests.find((r) => r.path.endsWith('/register'));
    expect(register?.authorization).toBe('Bearer business-token');
    const pin = (register?.body as { pin: string }).pin;
    expect(pin).toMatch(/^\d{6}$/);

    const [row] = await rowsOf('select * from wa_accounts');
    expect(row.credit_share_ref).toBe('alloc-1');
    expect(row.access_token_enc.toString()).not.toContain('business-token');
    expect(row.two_step_pin_enc.toString()).not.toContain(pin);
    await server.close();
  });

  it('assigned staff can do it; a refused code saves nothing and shares no credit', async () => {
    const server = signupApp();
    expect((await signup(server, ASHA, 'bad-code')).statusCode).toBe(400);
    expect((await rowsOf('select count(*) from wa_accounts'))[0].count).toBe(0);
    expect(fake.requests.filter((r) => r.path.endsWith('/whatsapp_credit_sharing_and_attach'))).toEqual([]);
    expect((await signup(server, MEERA)).statusCode).toBe(201);
    expect((await signup(server, MEERA)).json().error).toBe('ALREADY_CONNECTED');
    await server.close();
  });

  it('a registration failure saves nothing', async () => {
    const server = signupApp();
    fake.registerResponses = [metaError(400, 133005, 'Bad PIN')];
    const res = await signup(server);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('133005');
    expect((await rowsOf('select count(*) from wa_accounts'))[0].count).toBe(0);
    await server.close();
  });

  it('a sharing failure saves the account paused; resume refuses; retrying the share activates it', async () => {
    const server = signupApp();
    fake.creditResponses = [metaError(400, 100, 'Terms not accepted')];
    expect((await signup(server)).json()).toMatchObject({ status: 'paused', pausedReason: 'credit line not shared' });
    const [{ id }] = await rowsOf('select id from wa_accounts');

    const admin = (url: string) => server.inject({ method: 'POST', url, headers: { cookie: cookies[ADMIN]!, origin: PANEL } });
    const resume = await admin(`/api/admin/wa-accounts/${id}/resume`);
    expect(resume.statusCode).toBe(409);
    expect(resume.json().error).toBe('CREDIT_NOT_SHARED');

    fake.creditResponses = [metaError(400, 100, 'Still no')];
    expect((await admin(`/api/admin/wa-accounts/${id}/share-credit`)).statusCode).toBe(400);
    expect((await rowsOf('select status from wa_accounts'))[0].status).toBe('paused');

    expect((await admin(`/api/admin/wa-accounts/${id}/share-credit`)).statusCode).toBe(200);
    expect((await rowsOf('select status, paused_reason, credit_share_ref from wa_accounts'))[0]).toEqual({
      status: 'active',
      paused_reason: null,
      credit_share_ref: 'alloc-1',
    });
    expect((await admin(`/api/admin/wa-accounts/${id}/share-credit`)).statusCode).toBe(409);
    await server.close();
  });

  it('Meta saying the credit line is already shared counts as shared', async () => {
    const server = signupApp();
    fake.creditResponses = [metaError(400, 4000, 'A credit allocation already exists')];
    expect((await signup(server)).json().status).toBe('active');
    await server.close();
  });

  it('with no credit line set up (before E7), the account is paused and no share is tried', async () => {
    const server = signupApp({ metaCreditLineId: '' });
    expect((await signup(server)).json()).toMatchObject({ status: 'paused', pausedReason: 'credit line not shared' });
    expect(paths()).not.toContain('whatsapp_credit_sharing_and_attach');
    await server.close();
  });

  it('without an app ID it answers 503', async () => {
    const server = signupApp({ metaAppId: '' });
    expect((await signup(server)).statusCode).toBe(503);
    await server.close();
  });
});

describe('replacing a token', () => {
  it('a super admin replaces it after Meta accepts it; it does not resume the account', async () => {
    const { id } = await connect(w.ids.northwind);
    await w.pool.query(`update wa_accounts set status = 'paused', paused_reason = 'token invalid'`);
    const path = `/api/admin/wa-accounts/${id}/token`;

    expect((await call(ASHA, 'POST', path, { token: 'new-token' })).statusCode).toBe(403);
    expect((await call(ADMIN, 'POST', path, { token: 'wrong' })).statusCode).toBe(400);

    fake.validToken = 'new-token';
    const res = await call(ADMIN, 'POST', path, { token: 'new-token' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('new-token');
    const [row] = await rowsOf('select status, access_token_enc from wa_accounts');
    expect(row.status).toBe('paused');
    expect(decryptSecret(row.access_token_enc.toString(), KEY)).toBe('new-token');
    expect((await rowsOf(`select count(*) from audit_logs where action = 'wa_account.token_replaced'`))[0].count).toBe(1);
  });
});

describe('5.3.4 media headers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reaplift-media-'));
  const mediaApp = () => w.makeApp({ meta, encryptionKey: KEY, metaAppId: 'app-1', uploadDir: dir });
  const imageDraft = (accountId: string) =>
    draft(accountId, {
      name: 'with_image',
      category: 'MARKETING',
      components: [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Hello there, our new range is here today.' },
      ],
    });
  const upload = (server: ReturnType<typeof mediaApp>, id: string, type: string, bytes: Buffer, email = ASHA) =>
    server.inject({
      method: 'POST',
      url: url(id, '/media'),
      headers: { cookie: cookies[email]!, origin: PANEL, 'content-type': type },
      payload: bytes,
    });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('fails the rule until a file is uploaded; then stores it, saves the handle and submits', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const server = mediaApp();
    const id = (await call(ASHA, 'POST', url(''), imageDraft(accountId))).json().id;
    const failed = await call(ASHA, 'POST', url(id, '/submit'));
    expect(failed.statusCode).toBe(422);
    expect(failed.json().validationErrors[0].rule).toBe('media_file');

    const bytes = Buffer.from('fake jpeg bytes');
    const res = await upload(server, id, 'image/jpeg', bytes);
    expect(res.statusCode).toBe(200);
    expect(res.json().components[0].example.header_handle).toEqual(['handle-1']);
    expect(res.json().status).toBe('DRAFT');
    const [row] = await rowsOf('select media_storage_key from templates where id = $1', [id]);
    expect(readFileSync(path.join(dir, row.media_storage_key))).toEqual(bytes);
    expect(row.media_storage_key.startsWith(w.ids.northwind)).toBe(true);
    expect((await call(ASHA, 'POST', url(id, '/submit'))).statusCode).toBe(202);
    await server.close();
  });

  it('refuses the wrong type, an empty or oversized file, and another client', async () => {
    const { id: accountId } = await connect(w.ids.northwind);
    const server = mediaApp();
    const id = (await call(ASHA, 'POST', url(''), imageDraft(accountId))).json().id;
    expect((await upload(server, id, 'application/pdf', Buffer.from('x'))).statusCode).toBe(400);
    expect((await upload(server, id, 'image/jpeg', Buffer.alloc(0))).statusCode).toBe(400);
    expect((await upload(server, id, 'image/jpeg', Buffer.alloc(5 * 1024 * 1024 + 1))).statusCode).toBe(400);
    expect((await upload(server, id, 'image/jpeg', Buffer.from('x'), OTHER)).statusCode).toBe(404);
    expect((await rowsOf('select media_storage_key from templates where id = $1', [id]))[0].media_storage_key).toBeNull();
    await server.close();
  });
});
