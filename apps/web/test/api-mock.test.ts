import { LoginResponse, MeResponse } from '@reaplift/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, call } from '../src/api/client';
import { createMockTransport } from '../src/api/mock';
import type { Transport } from '../src/api/transport';

const PASSWORD = 'reaplift-dev-1';
let clock: Date;
let mock: Transport;

beforeEach(() => {
  clock = new Date('2026-10-30T10:00:00.000Z');
  mock = createMockTransport(() => clock);
});

const login = (email: string, password = PASSWORD) =>
  call(mock, { method: 'POST', path: '/api/auth/login', body: { email, password } }, LoginResponse);
const me = () => call(mock, { method: 'GET', path: '/api/auth/me' }, MeResponse);
const logout = () => call(mock, { method: 'POST', path: '/api/auth/logout' }, null);
const minutes = (n: number) => (clock = new Date(clock.getTime() + n * 60_000));

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('mock API: the worked example', () => {
  it.each([
    ['ravi@reaplift.com', 'super_admin', ['Bluebird Retail', 'Greenleaf Foods', 'Northwind Labs']],
    ['meera@reaplift.com', 'staff', ['Bluebird Retail', 'Northwind Labs']],
    ['ops@northwind.com', 'client', ['Northwind Labs']],
    ['sales@greenleaf.in', 'client', ['Greenleaf Foods']],
  ])('%s logs in as %s and sees %j', async (email, role, names) => {
    const { user } = await login(email);
    expect([user.email, user.role]).toEqual([email, role]);
    const body = await me();
    expect(body.user).toEqual(user);
    expect(body.workspaces.map((w) => w.name)).toEqual(names);
  });

  it('ignores case and spaces in the email, as the server does', async () => {
    expect((await login('  OPS@Northwind.com ')).user.email).toBe('ops@northwind.com');
  });
});

describe('mock API: wrong logins', () => {
  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await failure(login('ops@northwind.com', 'nope'));
    const unknown = await failure(login('nobody@example.com'));
    expect([wrong.status, wrong.code, wrong.message]).toEqual([401, 'INVALID_CREDENTIALS', 'Wrong email or password']);
    expect([unknown.status, unknown.code, unknown.message]).toEqual([wrong.status, wrong.code, wrong.message]);
  });

  it('answers 400 to the old prototype body with a role field', async () => {
    const err = await failure(
      call(
        mock,
        { method: 'POST', path: '/api/auth/login', body: { email: 'ops@northwind.com', password: PASSWORD, role: 'client' } },
        LoginResponse,
      ),
    );
    expect([err.status, err.code]).toEqual([400, 'INVALID_REQUEST']);
  });
});

describe('mock API: lockout', () => {
  it('locks after 10 failures, even for the right password, and unlocks after 15 minutes', async () => {
    for (let i = 0; i < 10; i++) expect((await failure(login('sales@greenleaf.in', 'wrong'))).status).toBe(401);

    const locked = await failure(login('sales@greenleaf.in'));
    expect([locked.status, locked.code]).toEqual([423, 'LOGIN_LOCKED']);
    expect((locked.body as { lockedUntil: string }).lockedUntil).toBe('2026-10-30T10:15:00.000Z');

    minutes(14);
    expect((await failure(login('sales@greenleaf.in'))).status).toBe(423);
    minutes(1);
    expect((await login('sales@greenleaf.in')).user.email).toBe('sales@greenleaf.in');
  });

  it('locks only that email', async () => {
    for (let i = 0; i < 10; i++) await failure(login('sales@greenleaf.in', 'wrong'));
    expect((await login('ops@northwind.com')).user.email).toBe('ops@northwind.com');
  });

  it('does not lock after 9 failures, and a good login resets the count', async () => {
    for (let i = 0; i < 9; i++) await failure(login('ops@northwind.com', 'wrong'));
    await login('ops@northwind.com');
    for (let i = 0; i < 9; i++) await failure(login('ops@northwind.com', 'wrong'));
    expect((await login('ops@northwind.com')).user.email).toBe('ops@northwind.com');
  });

  it('starts a new count once the 15-minute window has passed', async () => {
    for (let i = 0; i < 9; i++) await failure(login('ops@northwind.com', 'wrong'));
    minutes(15);
    expect((await failure(login('ops@northwind.com', 'wrong'))).status).toBe(401);
    expect((await login('ops@northwind.com')).user.email).toBe('ops@northwind.com');
  });
});

describe('mock API: session', () => {
  it('answers 401 to /me and logout before login', async () => {
    expect((await failure(me())).code).toBe('UNAUTHENTICATED');
    expect((await failure(logout())).code).toBe('UNAUTHENTICATED');
  });

  it('logs out with 204, after which /me is 401', async () => {
    await login('meera@reaplift.com');
    await expect(logout()).resolves.toBeUndefined();
    expect((await failure(me())).status).toBe(401);
  });

  it('answers 404 for a route it does not know', async () => {
    await login('ravi@reaplift.com');
    expect((await failure(call(mock, { method: 'GET', path: '/api/admin/clients' }, null))).code).toBe('NOT_FOUND');
  });
});
