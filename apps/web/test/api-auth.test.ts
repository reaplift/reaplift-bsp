import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiMode, login, logout, me } from '../src/api';

describe('apiMode', () => {
  it.each([
    [{ PROD: false, VITE_API_MODE: 'mock' }, 'mock'],
    [{ PROD: false, VITE_API_MODE: 'real' }, 'real'],
    [{ PROD: false, VITE_API_MODE: '' }, 'real'],
    [{ PROD: false }, 'real'],
    [{ PROD: false, VITE_API_MODE: 'Mock' }, 'real'],
  ])('%j gives %s', (env, mode) => {
    expect(apiMode(env)).toBe(mode);
  });

  it('is never mock in a production build, even when asked for', () => {
    expect(apiMode({ PROD: true, VITE_API_MODE: 'mock' })).toBe('real');
  });
});

describe('auth calls in real mode', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const reply = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  const user = { id: 'u1', name: 'Ravi', email: 'ravi@reaplift.com', role: 'super_admin' };

  beforeEach(() => {
    // Real mode whatever the developer's own .env says.
    vi.stubEnv('VITE_API_MODE', '');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('login posts email and password with the cookie and returns the user', async () => {
    reply(200, { user });
    await expect(login({ email: 'ravi@reaplift.com', password: 'pw' })).resolves.toEqual({ user });

    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'ravi@reaplift.com', password: 'pw' });
  });

  it('login rejects a response that does not match its schema', async () => {
    reply(200, { ok: true, token: 'abc' });
    const err = await login({ email: 'ravi@reaplift.com', password: 'pw' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('BAD_RESPONSE');
  });

  it('login passes on the server error code', async () => {
    reply(401, { error: 'INVALID_CREDENTIALS', message: 'Wrong email or password' });
    const err = await login({ email: 'ravi@reaplift.com', password: 'x' }).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('INVALID_CREDENTIALS');
  });

  it('me gets the user and workspaces with the cookie and no body', async () => {
    const body = { user, workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }] };
    reply(200, body);
    await expect(me()).resolves.toEqual(body);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect([path, init?.method, init?.credentials, init?.body]).toEqual(['/api/auth/me', 'GET', 'include', undefined]);
  });

  it('logout accepts the empty 204', async () => {
    reply(204);
    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/logout');
  });

  it('gives NETWORK_ERROR when fetch itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = await me().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('NETWORK_ERROR');
  });

  it('gives UNEXPECTED_ERROR for a non-JSON error page', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await me().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('UNEXPECTED_ERROR');
  });
});
