import {
  AdminClient,
  AdminClientDetail,
  AdminClientList,
  AdminUserList,
  AuditPage,
  DeliveryLog,
  LoginResponse,
  MeResponse,
  MyNotifications,
  type LoginRequest,
} from '@reaplift/shared';
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

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length > 0 ? `?${new URLSearchParams(entries)}` : '';
}

/** One typed function per route, over any transport. Screens use the default `api` below. */
export function createApi(transport: () => Transport | Promise<Transport>) {
  async function send<T>(request: ApiRequest, schema: ResponseSchema<T> | null): Promise<T> {
    return call(await transport(), request, schema);
  }
  return {
    /** POST /api/auth/login. On success the server sets the session cookie. */
    login: (body: LoginRequest) => send({ method: 'POST', path: '/api/auth/login', body }, LoginResponse),
    /** POST /api/auth/logout. Ends the session; answers 204 with no body. */
    logout: () => send({ method: 'POST', path: '/api/auth/logout' }, null),
    /** GET /api/auth/me. The logged-in user and the client workspaces they can open. */
    me: () => send({ method: 'GET', path: '/api/auth/me' }, MeResponse),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      send({ method: 'POST', path: '/api/me/password', body }, null),
    myNotifications: () => send({ method: 'GET', path: '/api/me/notifications' }, MyNotifications),
    markNotificationRead: (id: string) =>
      send({ method: 'PATCH', path: `/api/me/notifications/${id}/read` }, null),

    adminClients: () => send({ method: 'GET', path: '/api/admin/clients' }, AdminClientList),
    adminClient: (id: string) => send({ method: 'GET', path: `/api/admin/clients/${id}` }, AdminClientDetail),
    createClient: (body: { name: string; countryCallingCode: '91'; contactEmail: string }) =>
      send({ method: 'POST', path: '/api/admin/clients', body }, AdminClient),
    editClient: (id: string, body: { name?: string; contactEmail?: string }) =>
      send({ method: 'PATCH', path: `/api/admin/clients/${id}`, body }, AdminClient),
    setClientSuspended: (id: string, suspended: boolean, note: string) =>
      send({ method: 'POST', path: `/api/admin/clients/${id}/${suspended ? 'suspend' : 'reactivate'}`, body: { note } }, null),

    adminUsers: (filter: { role?: string; clientId?: string } = {}) =>
      send({ method: 'GET', path: `/api/admin/users${query(filter)}` }, AdminUserList),
    createUser: (body: {
      name: string;
      email: string;
      role: 'client' | 'staff';
      password: string;
      clientId?: string;
      clientIds?: string[];
    }) => send({ method: 'POST', path: '/api/admin/users', body }, null),
    setUserStatus: (id: string, status: 'active' | 'disabled') =>
      send({ method: 'PATCH', path: `/api/admin/users/${id}`, body: { status } }, null),
    resetPassword: (id: string, password: string) =>
      send({ method: 'POST', path: `/api/admin/users/${id}/reset-password`, body: { password } }, null),
    setStaffClients: (id: string, clientIds: string[]) =>
      send({ method: 'PUT', path: `/api/admin/users/${id}/clients`, body: { clientIds } }, null),

    audit: (filter: { clientId?: string; userId?: string; action?: string; from?: string; to?: string; cursor?: string }) =>
      send({ method: 'GET', path: `/api/admin/audit${query(filter)}` }, AuditPage),
    deliveryLog: (status?: string) =>
      send({ method: 'GET', path: `/api/admin/notifications${query({ status })}` }, DeliveryLog),
  };
}

export type Api = ReturnType<typeof createApi>;

/** The panel's API: the real server, or the mock when VITE_API_MODE=mock in development. */
export const api: Api = createApi(getTransport);
export const { login, logout, me } = api;
