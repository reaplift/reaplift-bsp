import { LoginResponse, MeResponse, type LoginRequest } from '@reaplift/shared';
import { call, type ResponseSchema } from './client';
import { fetchTransport, type ApiRequest, type Transport } from './transport';

export { ApiError } from './client';

export type ApiMode = 'real' | 'mock';

/** `mock` only in development and only when asked for; a production build is always `real`. */
export function apiMode(env: { PROD: boolean; VITE_API_MODE?: string }): ApiMode {
  return !env.PROD && env.VITE_API_MODE === 'mock' ? 'mock' : 'real';
}

let transport: Promise<Transport> | undefined;

function getTransport(): Promise<Transport> {
  transport ??= (async () => {
    // A production build replaces import.meta.env.PROD with `true`, so everything after this line
    // is unreachable there and the mock (its users and password) is left out of the bundle.
    if (import.meta.env.PROD) return fetchTransport;
    if (apiMode(import.meta.env) === 'mock') {
      console.info('[api] VITE_API_MODE=mock: answering from src/api/mock, not the server');
      return (await import('./mock')).mockTransport;
    }
    return fetchTransport;
  })();
  return transport;
}

async function send<T>(request: ApiRequest, schema: ResponseSchema<T> | null): Promise<T> {
  return call(await getTransport(), request, schema);
}

/** POST /api/auth/login. On success the server sets the session cookie. */
export function login(body: LoginRequest) {
  return send({ method: 'POST', path: '/api/auth/login', body }, LoginResponse);
}

/** POST /api/auth/logout. Ends the session; answers 204 with no body. */
export function logout() {
  return send({ method: 'POST', path: '/api/auth/logout' }, null);
}

/** GET /api/auth/me. The logged-in user and the client workspaces they can open. */
export function me() {
  return send({ method: 'GET', path: '/api/auth/me' }, MeResponse);
}
