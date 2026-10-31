import { LoginResponse, MeResponse } from '@reaplift/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, call } from '../src/api/client';
import type { ApiResponse, Transport } from '../src/api/transport';

const answer =
  (response: ApiResponse): Transport =>
  async () =>
    response;
const login = { method: 'POST' as const, path: '/api/auth/login', body: { email: 'a@b.in', password: 'x' } };
const user = { id: 'u1', name: 'Northwind Ops', email: 'ops@northwind.com', role: 'client' };

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('call', () => {
  it('returns the response when it matches the schema', async () => {
    await expect(call(answer({ status: 200, body: { user } }), login, LoginResponse)).resolves.toEqual({ user });
  });

  it('rejects a 200 response that does not match the schema', async () => {
    // The old prototype's login response: what crashed the Admin page before.
    const err = await failure(call(answer({ status: 200, body: { ok: true, token: 't' } }), login, LoginResponse));
    expect(err.code).toBe('BAD_RESPONSE');
    expect(err.status).toBe(200);
  });

  it('rejects a list where the schema expects an object', async () => {
    const err = await failure(call(answer({ status: 200, body: [] }), login, MeResponse));
    expect(err.code).toBe('BAD_RESPONSE');
  });

  it("turns the server's error body into an ApiError with its code", async () => {
    const body = { error: 'INVALID_CREDENTIALS', message: 'Wrong email or password' };
    const err = await failure(call(answer({ status: 401, body }), login, LoginResponse));
    expect([err.status, err.code, err.message]).toEqual([401, 'INVALID_CREDENTIALS', 'Wrong email or password']);
  });

  it('keeps the whole body, so a 423 still carries lockedUntil', async () => {
    const body = { error: 'LOGIN_LOCKED', message: 'Locked', lockedUntil: '2026-10-30T05:35:26.274Z' };
    const err = await failure(call(answer({ status: 423, body }), login, LoginResponse));
    expect(err.code).toBe('LOGIN_LOCKED');
    expect(err.body).toEqual(body);
  });

  it('gives UNEXPECTED_ERROR when an error has no proper body (a proxy page, empty body)', async () => {
    expect((await failure(call(answer({ status: 502, body: '<html>Bad gateway</html>' }), login, null))).code).toBe(
      'UNEXPECTED_ERROR',
    );
    expect((await failure(call(answer({ status: 500, body: null }), login, null))).code).toBe('UNEXPECTED_ERROR');
  });

  it('gives NETWORK_ERROR when the server cannot be reached', async () => {
    const down: Transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await failure(call(down, login, LoginResponse));
    expect([err.status, err.code]).toEqual([0, 'NETWORK_ERROR']);
  });

  it('returns nothing for a 204 when no schema is given', async () => {
    await expect(call(answer({ status: 204, body: null }), { method: 'POST', path: '/api/auth/logout' }, null)).resolves.toBeUndefined();
  });
});
