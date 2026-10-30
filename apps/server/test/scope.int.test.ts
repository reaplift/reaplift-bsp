import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyRoute } from '../src/modules/auth/scope.js';
import { createWorld, PANEL } from './support/world.js';

let w: Awaited<ReturnType<typeof createWorld>>;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  w = await createWorld();
  for (const email of [
    'ravi@reaplift.com',
    'meera@reaplift.com',
    'ops@northwind.com',
    'sales@greenleaf.in',
    'ops@paused.co',
  ]) {
    cookies[email] = (await w.login(email)).cookie;
  }
});
afterAll(() => w.close());

const get = (email: string | null, url: string) =>
  w.app.inject({ method: 'GET', url, headers: email ? { cookie: cookies[email]! } : {} });

describe('1.4 workspaces from /api/auth/me', () => {
  const names = async (email: string) =>
    ((await get(email, '/api/auth/me')).json().workspaces as Array<{ name: string }>).map(
      (x) => x.name,
    );

  it('gives a client user only their own client', async () => {
    expect(await names('ops@northwind.com')).toEqual(['Northwind Labs']);
  });

  it('gives staff only their assigned clients', async () => {
    expect(await names('meera@reaplift.com')).toEqual(['Bluebird Retail', 'Northwind Labs']);
  });

  it('gives the super admin every client', async () => {
    expect(await names('ravi@reaplift.com')).toEqual([
      'Bluebird Retail',
      'Greenleaf Foods',
      'Northwind Labs',
      'Paused Co',
    ]);
  });

  it('needs a login', async () => {
    expect((await get(null, '/api/auth/me')).statusCode).toBe(401);
  });
});

describe('1.4 client routes', () => {
  const status = async (email: string | null, clientId: string) =>
    (await get(email, `/api/clients/${clientId}`)).statusCode;

  it('client user: own client 200, another client 404', async () => {
    expect(await status('ops@northwind.com', w.ids.northwind)).toBe(200);
    expect(await status('ops@northwind.com', w.ids.greenleaf)).toBe(404);
  });

  it('staff: assigned client 200, unassigned client 404', async () => {
    expect(await status('meera@reaplift.com', w.ids.bluebird)).toBe(200);
    expect(await status('meera@reaplift.com', w.ids.greenleaf)).toBe(404);
  });

  it('super admin: any client 200', async () => {
    expect(await status('ravi@reaplift.com', w.ids.greenleaf)).toBe(200);
  });

  it('an unknown or malformed client ID looks exactly like a forbidden one', async () => {
    const forbidden = await get('ops@northwind.com', `/api/clients/${w.ids.greenleaf}`);
    const unknown = await get(
      'ops@northwind.com',
      '/api/clients/00000000-0000-4000-8000-000000000000',
    );
    const malformed = await get('ops@northwind.com', '/api/clients/not-a-uuid');
    expect(unknown.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(unknown.body).toBe(forbidden.body);
    expect(malformed.body).toBe(forbidden.body);
  });

  it("a suspended client's users can log in but get 403 CLIENT_SUSPENDED", async () => {
    expect((await get('ops@paused.co', '/api/auth/me')).statusCode).toBe(200);
    const res = await get('ops@paused.co', `/api/clients/${w.ids.suspended}`);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'CLIENT_SUSPENDED' });
  });

  it('needs a login', async () => {
    expect(await status(null, w.ids.northwind)).toBe(401);
  });
});

describe('1.4 admin routes', () => {
  it('super admin only; others get 403 FORBIDDEN', async () => {
    expect((await get('ravi@reaplift.com', '/api/admin/clients')).statusCode).toBe(200);
    for (const email of ['meera@reaplift.com', 'ops@northwind.com']) {
      const res = await get(email, '/api/admin/clients');
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
    }
    expect((await get(null, '/api/admin/clients')).statusCode).toBe(401);
  });
});

describe('1.5 every route has an access rule and enforces it', () => {
  const fill = (url: string, clientId: string) =>
    url
      .replace(':clientId', clientId)
      .replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');

  it('no route is outside /api/clients/, /api/admin/, /api/me/ or the public and session lists', () => {
    const unscoped = w.app.routeList.filter((r) => classifyRoute(r.url) === 'unscoped');
    expect(unscoped).toEqual([]);
  });

  it("every client route answers 404 to another client's user", async () => {
    const routes = w.app.routeList.filter((r) => classifyRoute(r.url) === 'client');
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const res = await w.app.inject({
        method: r.method as 'GET',
        url: fill(r.url, w.ids.greenleaf),
        headers: { cookie: cookies['ops@northwind.com']!, origin: PANEL },
        payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404);
    }
  });

  it('every admin route answers 403 to a client user and 401 without a login', async () => {
    const routes = w.app.routeList.filter((r) => classifyRoute(r.url) === 'admin');
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const url = fill(r.url, w.ids.greenleaf);
      const payload = r.method === 'GET' || r.method === 'DELETE' ? undefined : {};
      const asClient = await w.app.inject({
        method: r.method as 'GET',
        url,
        headers: { cookie: cookies['ops@northwind.com']!, origin: PANEL },
        payload,
      });
      expect(asClient.statusCode, `${r.method} ${r.url}`).toBe(403);
      const anonymous = await w.app.inject({
        method: r.method as 'GET',
        url,
        headers: { origin: PANEL },
        payload,
      });
      expect(anonymous.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('/api/me/ routes never take a user ID from the path; they act on the logged-in user', () => {
    const routes = w.app.routeList.filter((r) => classifyRoute(r.url) === 'me');
    for (const r of routes) expect(r.url, r.url).not.toMatch(/:userId|:id\b/);
  });
});
