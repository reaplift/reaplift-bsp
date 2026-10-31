import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderEmail } from './support/render-email.js';
import { createWorld, PANEL, PASSWORD } from './support/world.js';

let w: Awaited<ReturnType<typeof createWorld>>;
let ravi = '';
const FIRST = 'Temp-4821-north';
const CHOSEN = 'Asha-chose-this-1';

const call = (cookie: string | null, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
  w.app.inject({
    method,
    url,
    headers: { origin: PANEL, ...(cookie ? { cookie } : {}) },
    ...(payload ? { payload } : {}),
  });
const rows = async (query: string, values: unknown[] = []) => (await w.pool.query(query, values)).rows;
const count = async (query: string, values: unknown[] = []) => (await rows(query, values))[0].count;
const login = async (email: string, password: string) => (await w.login(email, password)).cookie;

beforeAll(async () => {
  w = await createWorld();
  ravi = await login('ravi@reaplift.com', PASSWORD);
});
afterAll(() => w.close());

describe('M3 worked example', () => {
  let northwind = '';
  let asha = '';
  let meera = '';
  let meeraCookie = '';

  it('step 1: creates a client, with one audit row and a note to its contact', async () => {
    const res = await call(ravi, 'POST', '/api/admin/clients', {
      name: 'Acme Northwind',
      countryCallingCode: '91',
      contactEmail: 'ops@acme-northwind.com',
    });
    expect(res.statusCode).toBe(201);
    northwind = res.json().id;
    expect(res.json()).toMatchObject({ status: 'active', countryCallingCode: '91' });
    expect((await call(ravi, 'GET', '/api/admin/clients')).json().items.map((c: { name: string }) => c.name)).toContain('Acme Northwind');
    expect(await rows(`select action, user_id is not null as by_user from audit_logs where entity_id = $1`, [northwind])).toEqual([
      { action: 'client.created', by_user: true },
    ]);
    expect(await count(`select count(*) from notifications where event = 'client.created' and email = 'ops@acme-northwind.com'`)).toBe(1);
  });

  it('refuses a repeat name in any case, a missing country, and a missing email', async () => {
    const base = { countryCallingCode: '91', contactEmail: 'a@b.co' };
    const repeat = await call(ravi, 'POST', '/api/admin/clients', { ...base, name: 'ACME NORTHWIND' });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().error).toBe('CLIENT_NAME_TAKEN');
    const noCountry = await call(ravi, 'POST', '/api/admin/clients', { name: 'X', contactEmail: 'a@b.co' });
    expect(noCountry.statusCode).toBe(400);
    expect(noCountry.json().details.fieldErrors.countryCallingCode).toBeDefined();
    expect((await call(ravi, 'POST', '/api/admin/clients', { ...base, countryCallingCode: '1', name: 'X' })).statusCode).toBe(400);
    expect((await call(ravi, 'POST', '/api/admin/clients', { name: 'X', countryCallingCode: '91' })).statusCode).toBe(400);
  });

  it('step 2: creates a login, sets who made it, and never mails the password', async () => {
    const res = await call(ravi, 'POST', '/api/admin/users', {
      name: 'Asha Rao',
      email: 'Asha@northwind-demo.com',
      role: 'client',
      clientId: northwind,
      password: FIRST,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain(FIRST);
    asha = res.json().id;
    const [row] = await rows('select email, created_by, must_change_password, password_hash from users where id = $1', [asha]);
    expect(row.email).toBe('asha@northwind-demo.com');
    expect(row.created_by).not.toBeNull();
    expect(row.must_change_password).toBe(true);
    expect(row.password_hash).not.toContain(FIRST);

    const [mail] = await rows(`select event, payload from notifications where user_id = $1`, [asha]);
    const email = renderEmail(mail.event, mail.payload);
    expect(email.subject).toBe('Your ReapLift login is ready');
    expect(email.text).toContain('asha@northwind-demo.com');
    expect(JSON.stringify(mail)).not.toContain(FIRST);
    expect(email.text).not.toContain(FIRST);

    const audit = await rows(`select details from audit_logs where entity_id = $1`, [asha]);
    expect(JSON.stringify(audit)).not.toContain(FIRST);
  });

  it('refuses a taken email, a client user with no client, and a short password', async () => {
    const base = { name: 'X', password: 'long-enough-1', role: 'client', clientId: northwind };
    const taken = await call(ravi, 'POST', '/api/admin/users', { ...base, email: 'asha@northwind-demo.com' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('EMAIL_TAKEN');
    expect((await call(ravi, 'POST', '/api/admin/users', { name: 'X', email: 'x@y.co', password: 'long-enough-1', role: 'client' })).statusCode).toBe(400);
    expect((await call(ravi, 'POST', '/api/admin/users', { ...base, email: 'x@y.co', password: 'short' })).statusCode).toBe(400);
    expect((await call(ravi, 'POST', '/api/admin/users', { ...base, email: 'x@y.co', role: 'super_admin' })).statusCode).toBe(400);
  });

  it('step 3: first login must change the password; the old one then stops working', async () => {
    const cookie = await login('asha@northwind-demo.com', FIRST);
    const blocked = await call(cookie, 'GET', `/api/clients/${northwind}`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await call(cookie, 'GET', '/api/auth/me')).statusCode).toBe(403);

    expect((await call(cookie, 'POST', '/api/me/password', { currentPassword: 'wrong-password', newPassword: CHOSEN })).statusCode).toBe(401);
    expect((await call(cookie, 'POST', '/api/me/password', { currentPassword: FIRST, newPassword: 'short' })).statusCode).toBe(400);
    expect((await call(cookie, 'POST', '/api/me/password', { currentPassword: FIRST, newPassword: FIRST })).statusCode).toBe(400);
    expect((await call(cookie, 'POST', '/api/me/password', { currentPassword: FIRST, newPassword: CHOSEN })).statusCode).toBe(200);

    expect((await call(cookie, 'GET', `/api/clients/${northwind}`)).statusCode).toBe(200);
    expect((await w.login('asha@northwind-demo.com', FIRST)).res.statusCode).toBe(401);
    expect((await w.login('asha@northwind-demo.com', CHOSEN)).res.statusCode).toBe(200);
  });

  it('a user can log out while a password change is pending', async () => {
    await call(ravi, 'POST', '/api/admin/users', { name: 'Tmp', email: 'tmp@northwind-demo.com', role: 'client', clientId: northwind, password: FIRST });
    const cookie = await login('tmp@northwind-demo.com', FIRST);
    expect((await call(cookie, 'POST', '/api/auth/logout')).statusCode).toBe(204);
  });

  it('step 4: staff are assigned clients, told, and see exactly those', async () => {
    const res = await call(ravi, 'POST', '/api/admin/users', {
      name: 'Meera Two',
      email: 'meera2@reaplift.com',
      role: 'staff',
      password: FIRST,
      clientIds: [northwind, w.ids.bluebird],
    });
    expect(res.statusCode).toBe(201);
    meera = res.json().id;
    meeraCookie = await login('meera2@reaplift.com', FIRST);
    await call(meeraCookie, 'POST', '/api/me/password', { currentPassword: FIRST, newPassword: CHOSEN });
    const names = (await call(meeraCookie, 'GET', '/api/auth/me')).json().workspaces.map((x: { name: string }) => x.name);
    expect(names).toEqual(['Acme Northwind', 'Bluebird Retail']);

    const mail = await rows(`select event, payload from notifications where user_id = $1 and event = 'staff.assigned' and channel = 'email'`, [meera]);
    expect(renderEmail(mail[0].event, mail[0].payload).text).toContain('Acme Northwind, Bluebird Retail');

    const bell = (await call(meeraCookie, 'GET', '/api/me/notifications')).json();
    expect(bell.unreadCount).toBe(1);
    expect(bell.items[0].event).toBe('staff.assigned');
  });

  it('saving staff clients replaces the list, records before and after, and takes effect at once', async () => {
    const res = await call(ravi, 'PUT', `/api/admin/users/${meera}/clients`, { clientIds: [northwind] });
    expect(res.statusCode).toBe(200);
    expect((await call(meeraCookie, 'GET', `/api/clients/${w.ids.bluebird}`)).statusCode).toBe(404);
    expect((await call(meeraCookie, 'GET', `/api/clients/${northwind}`)).statusCode).toBe(200);
    const [audit] = await rows(`select details from audit_logs where action = 'staff.assigned' and entity_id = $1 order by id desc limit 1`, [meera]);
    expect(audit.details.before).toContain(w.ids.bluebird);
    expect(audit.details.after).toEqual([northwind]);

    expect((await call(ravi, 'PUT', `/api/admin/users/${asha}/clients`, { clientIds: [northwind] })).statusCode).toBe(409);
    expect((await call(ravi, 'PUT', `/api/admin/users/${meera}/clients`, { clientIds: ['00000000-0000-4000-8000-000000000000'] })).statusCode).toBe(400);
    await call(ravi, 'PUT', `/api/admin/users/${meera}/clients`, { clientIds: [northwind, w.ids.bluebird] });
  });

  it('step 5: suspending needs a note, blocks client routes, revokes nothing, and leaves other clients open', async () => {
    const path = `/api/admin/clients/${w.ids.bluebird}`;
    expect((await call(ravi, 'POST', `${path}/suspend`, {})).statusCode).toBe(400);
    expect((await call(ravi, 'POST', `${path}/suspend`, { note: 'invoice overdue' })).statusCode).toBe(200);
    const blocked = await call(meeraCookie, 'GET', `/api/clients/${w.ids.bluebird}`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('CLIENT_SUSPENDED');
    expect((await call(meeraCookie, 'GET', `/api/clients/${northwind}`)).statusCode).toBe(200);
    expect(await count(`select count(*) from notifications where event = 'client.suspended' and channel = 'email'`)).toBeGreaterThan(0);
    expect((await call(ravi, 'POST', `${path}/suspend`, { note: 'again' })).statusCode).toBe(409);

    expect((await call(ravi, 'POST', `${path}/reactivate`, {})).statusCode).toBe(400);
    expect((await call(ravi, 'POST', `${path}/reactivate`, { note: 'paid' })).statusCode).toBe(200);
    expect((await call(meeraCookie, 'GET', `/api/clients/${w.ids.bluebird}`)).statusCode).toBe(200);

    await call(ravi, 'POST', `${path}/suspend`, { note: 'second time' });
    await call(ravi, 'POST', `${path}/reactivate`, { note: 'paid again' });
    expect(await count(`select count(*) from notifications where event = 'client.suspended' and email = 'meera2@reaplift.com' and channel = 'email'`)).toBe(2);
  });

  it('step 6: a reset revokes sessions and forces a change; the email holds no password', async () => {
    const before = await login('asha@northwind-demo.com', CHOSEN);
    const next = 'Reset-password-2';
    const res = await call(ravi, 'POST', `/api/admin/users/${asha}/reset-password`, { password: next });
    expect(res.statusCode).toBe(200);
    expect((await call(before, 'GET', '/api/auth/me')).statusCode).toBe(401);
    const cookie = await login('asha@northwind-demo.com', next);
    expect((await call(cookie, 'GET', '/api/auth/me')).json().error).toBe('PASSWORD_CHANGE_REQUIRED');
    const [mail] = await rows(`select event, payload from notifications where user_id = $1 and event = 'user.password_reset'`, [asha]);
    expect(JSON.stringify(mail)).not.toContain(next);
    await call(cookie, 'POST', '/api/me/password', { currentPassword: next, newPassword: CHOSEN });
  });

  it('disabling a user revokes sessions at once; enabling allows login again; you cannot disable yourself', async () => {
    const cookie = await login('asha@northwind-demo.com', CHOSEN);
    expect((await call(ravi, 'PATCH', `/api/admin/users/${asha}`, { status: 'disabled' })).statusCode).toBe(200);
    expect((await call(cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await w.login('asha@northwind-demo.com', CHOSEN)).res.statusCode).toBe(401);
    expect((await call(ravi, 'PATCH', `/api/admin/users/${asha}`, { status: 'active' })).statusCode).toBe(200);
    expect((await w.login('asha@northwind-demo.com', CHOSEN)).res.statusCode).toBe(200);

    const raviId = (await call(ravi, 'GET', '/api/auth/me')).json().user.id;
    expect((await call(ravi, 'PATCH', `/api/admin/users/${raviId}`, { status: 'disabled' })).statusCode).toBe(409);
  });

  it('step 7: the audit log filters by client, user, action and date, with before and after', async () => {
    const page = (await call(ravi, 'GET', `/api/admin/audit?clientId=${northwind}`)).json();
    const actions = page.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['client.created', 'user.created', 'user.password_reset']));
    expect(page.items[0].userName).toBe('ravi');

    const byAction = (await call(ravi, 'GET', '/api/admin/audit?action=client.suspended')).json().items;
    expect(byAction).toHaveLength(2);
    expect(byAction[0].details).toMatchObject({ before: { status: 'active' }, after: { status: 'suspended' }, note: 'second time' });

    const raviId = (await call(ravi, 'GET', '/api/auth/me')).json().user.id;
    expect((await call(ravi, 'GET', `/api/admin/audit?userId=${raviId}&limit=1`)).json().nextCursor).not.toBeNull();
    expect((await call(ravi, 'GET', '/api/admin/audit?to=2000-01-01')).json().items).toEqual([]);
    expect((await call(ravi, 'GET', '/api/admin/audit?clientId=nope')).statusCode).toBe(400);
    expect((await call(ravi, 'GET', '/api/admin/audit?from=nope')).statusCode).toBe(400);

    const first = (await call(ravi, 'GET', '/api/admin/audit?limit=2')).json();
    const second = (await call(ravi, 'GET', `/api/admin/audit?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items[0].id).toBeLessThan(first.items[1].id);
  });

  it('every change writes an audit row, and a change that fails writes none', async () => {
    const before = await count('select count(*) from audit_logs');
    await call(ravi, 'POST', '/api/admin/clients', { name: 'Acme Northwind', countryCallingCode: '91', contactEmail: 'a@b.co' });
    await call(ravi, 'POST', '/api/admin/users', { name: 'X', email: 'asha@northwind-demo.com', role: 'client', clientId: northwind, password: FIRST });
    expect(await count('select count(*) from audit_logs')).toBe(before);

    const edit = await call(ravi, 'PATCH', `/api/admin/clients/${northwind}`, { contactEmail: 'new@acme-northwind.com' });
    expect(edit.statusCode).toBe(200);
    expect(await count('select count(*) from audit_logs')).toBe(before + 1);
    const taken = await call(ravi, 'PATCH', `/api/admin/clients/${northwind}`, { name: 'Bluebird Retail' });
    expect(taken.statusCode).toBe(409);
    expect((await call(ravi, 'PATCH', `/api/admin/clients/${northwind}`, {})).statusCode).toBe(400);
    expect(await count('select count(*) from audit_logs')).toBe(before + 1);

    const detail = (await call(ravi, 'GET', `/api/admin/clients/${northwind}`)).json();
    expect(detail.contactEmail).toBe('new@acme-northwind.com');
    expect(detail.users.map((u: { email: string }) => u.email)).toContain('asha@northwind-demo.com');
    expect(detail.staff.map((u: { email: string }) => u.email)).toContain('meera2@reaplift.com');
    expect(JSON.stringify(detail)).not.toContain('password_hash');
  });
});

describe('3.6 and 3.7 notifications', () => {
  it('a user sees and marks only their own; client and staff are refused the delivery log', async () => {
    const meera = await login('meera@reaplift.com', PASSWORD);
    const greenleaf = await login('sales@greenleaf.in', PASSWORD);
    await call(ravi, 'POST', `/api/admin/clients/${w.ids.northwind}/suspend`, { note: 'test' });
    await call(ravi, 'POST', `/api/admin/clients/${w.ids.northwind}/reactivate`, { note: 'test' });

    const mine = (await call(meera, 'GET', '/api/me/notifications')).json();
    expect(mine.unreadCount).toBeGreaterThan(0);
    const id = mine.items[0].id;
    expect((await call(greenleaf, 'PATCH', `/api/me/notifications/${id}/read`)).statusCode).toBe(404);
    expect((await call(meera, 'PATCH', `/api/me/notifications/${id}/read`)).statusCode).toBe(200);
    expect((await call(meera, 'GET', '/api/me/notifications')).json().unreadCount).toBe(mine.unreadCount - 1);
    expect((await call(meera, 'PATCH', '/api/me/notifications/nope/read')).statusCode).toBe(404);

    expect((await call(meera, 'GET', '/api/admin/notifications')).statusCode).toBe(403);
    expect((await call(greenleaf, 'GET', '/api/admin/notifications')).statusCode).toBe(403);
    const log = (await call(ravi, 'GET', '/api/admin/notifications?status=pending')).json().items;
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((n: { status: string }) => n.status === 'pending')).toBe(true);
  });

  it('a login locked by wrong passwords tells its owner', async () => {
    for (let i = 0; i < 10; i++) await w.login('sales@greenleaf.in', 'wrong-password-x');
    expect(await count(`select count(*) from notifications where event = 'user.locked' and email = 'sales@greenleaf.in'`)).toBe(1);
  });
});
