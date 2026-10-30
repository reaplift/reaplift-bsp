import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/lib/auth.js';
import { IDLE_MS } from '../src/modules/auth/sessions.js';
import { createWorld, PANEL, PASSWORD } from './support/world.js';

let w: Awaited<ReturnType<typeof createWorld>>;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());

const me = (cookie: string, app = w.app) =>
  app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
const MINUTE = 60 * 1000;

describe.sequential('1.2 login, sessions, logout', () => {
  it('logs in, sets a locked-down cookie, and stores only the token hash', async () => {
    const { res, cookie } = await w.login('ops@northwind.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: 'ops@northwind.com', role: 'client' } });
    expect(res.json()).not.toHaveProperty('token');

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^rl_session=[a-f0-9]{64};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);

    const token = cookie.split('=')[1]!;
    const stored = await sql<{ n: number }>`
      select count(*)::int as n from auth_sessions where token_hash = ${hashToken(token)}`.execute(
      w.db,
    );
    expect(stored.rows[0]!.n).toBe(1);
    const plain = await sql<{ n: number }>`
      select count(*)::int as n from auth_sessions where token_hash = ${token}`.execute(w.db);
    expect(plain.rows[0]!.n).toBe(0);
  });

  it('accepts only email and password in the body', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PANEL },
      payload: { email: 'ops@northwind.com', password: PASSWORD, role: 'client' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_REQUEST' });
  });

  it('refuses a wrong password with 401', async () => {
    const { res } = await w.login('ops@northwind.com', 'not-the-password');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'Wrong email or password',
    });
  });

  it('refuses a state-changing request from another origin', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: 'ops@northwind.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    const noOrigin = await w.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ops@northwind.com', password: PASSWORD },
    });
    expect(noOrigin.statusCode).toBe(403);
  });

  it('keeps the session across a server restart', async () => {
    const { cookie } = await w.login('ops@northwind.com');
    const restarted = w.makeApp();
    const res = await me(cookie, restarted);
    expect(res.statusCode).toBe(200);
    await restarted.close();
  });

  it('logout revokes the session and clears the cookie', async () => {
    const { cookie } = await w.login('ops@northwind.com');
    const out = await w.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: PANEL },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/Max-Age=0/);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('expires a session 12 hours after the last request', async () => {
    const { cookie } = await w.login('ops@northwind.com');
    w.advance(IDLE_MS - MINUTE);
    expect((await me(cookie)).statusCode).toBe(200); // slides the expiry
    w.advance(IDLE_MS - MINUTE);
    expect((await me(cookie)).statusCode).toBe(200);
    w.advance(IDLE_MS + MINUTE);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('ends a session after 7 days even when it is used every few hours', async () => {
    const { cookie } = await w.login('ops@northwind.com');
    for (let hours = 0; hours < 7 * 24 - 6; hours += 6) {
      w.advance(6 * 60 * MINUTE);
      expect((await me(cookie)).statusCode).toBe(200);
    }
    w.advance(7 * 60 * MINUTE);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('refuses a disabled user with the same 401 as a wrong password, and drops their sessions', async () => {
    const { cookie } = await w.login('sales@greenleaf.in');
    await sql`update users set status = 'disabled' where email = 'sales@greenleaf.in'`.execute(
      w.db,
    );
    expect((await me(cookie)).statusCode).toBe(401);
    const { res } = await w.login('sales@greenleaf.in');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'Wrong email or password',
    });
    await sql`update users set status = 'active' where email = 'sales@greenleaf.in'`.execute(w.db);
  });
});

describe.sequential('1.3 lockout', () => {
  const fail = (email: string) => w.login(email, 'not-the-password');

  it('gives an unknown email the same 401 as a wrong password', async () => {
    const { res } = await w.login('nobody@nowhere.com');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: 'INVALID_CREDENTIALS',
      message: 'Wrong email or password',
    });
  });

  it('locks the 11th attempt after 10 failures in 15 minutes, even with the right password', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await fail('sales@greenleaf.in')).res.statusCode).toBe(401);
      w.advance(30 * 1000);
    }
    const { res } = await w.login('sales@greenleaf.in');
    expect(res.statusCode).toBe(423);
    expect(res.json()).toMatchObject({ error: 'LOGIN_LOCKED' });
    expect(Date.parse(res.json().lockedUntil)).toBeGreaterThan(0);
  });

  it('unlocks after 15 minutes', async () => {
    w.advance(15 * MINUTE);
    expect((await w.login('sales@greenleaf.in')).res.statusCode).toBe(200);
  });

  it('a successful login resets the count', async () => {
    for (let i = 0; i < 9; i++) await fail('ops@northwind.com');
    expect((await w.login('ops@northwind.com')).res.statusCode).toBe(200);
    for (let i = 0; i < 9; i++) await fail('ops@northwind.com');
    expect((await w.login('ops@northwind.com')).res.statusCode).toBe(200);
  });

  it('does not lock for failures spread over more than 15 minutes', async () => {
    for (let i = 0; i < 12; i++) {
      await fail('meera@reaplift.com');
      w.advance(2 * MINUTE);
    }
    expect((await w.login('meera@reaplift.com')).res.statusCode).toBe(200);
  });
});
