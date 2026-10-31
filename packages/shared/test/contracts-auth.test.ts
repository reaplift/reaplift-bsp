import { describe, expect, it } from 'vitest';
import {
  ApiErrorBody,
  LoginLockedBody,
  LoginRequest,
  LoginResponse,
  MeResponse,
} from '../src/contracts/auth.js';

// Bodies as the real server sent them (docs/milestones/m1-login-and-access/backend-api.md).
const user = {
  id: '531a7974-0000-4000-8000-000000000000',
  name: 'Northwind Ops',
  email: 'ops@northwind.com',
  role: 'client',
};

describe('auth contracts', () => {
  it('accepts the real login response', () => {
    expect(LoginResponse.parse({ user })).toEqual({ user });
  });

  it('accepts the real /me response', () => {
    const body = {
      user,
      workspaces: [{ clientId: '2ea171a2-0000-4000-8000-000000000000', name: 'Northwind Labs', status: 'active' }],
    };
    expect(MeResponse.parse(body)).toEqual(body);
  });

  it('accepts the real 423 lockout body', () => {
    const body = {
      error: 'LOGIN_LOCKED',
      message: 'Too many failed logins; try again later',
      lockedUntil: '2026-10-30T05:35:26.274Z',
    };
    expect(LoginLockedBody.parse(body)).toEqual(body);
  });

  it('accepts the shared error body', () => {
    const body = { error: 'INVALID_CREDENTIALS', message: 'Wrong email or password' };
    expect(ApiErrorBody.parse(body)).toEqual(body);
  });

  it('refuses the old prototype login body with a role field, as the server does', () => {
    expect(LoginRequest.safeParse({ email: 'a@b.in', password: 'x', role: 'client' }).success).toBe(false);
    expect(LoginRequest.safeParse({ email: 'a@b.in', password: 'x' }).success).toBe(true);
  });

  it('refuses an empty email or password', () => {
    expect(LoginRequest.safeParse({ email: '', password: 'x' }).success).toBe(false);
    expect(LoginRequest.safeParse({ email: 'a@b.in', password: '' }).success).toBe(false);
  });

  it('refuses a role the platform does not have (the old client_admin)', () => {
    expect(LoginResponse.safeParse({ user: { ...user, role: 'client_admin' } }).success).toBe(false);
  });

  it('refuses the old prototype login response (ok + token, no user)', () => {
    expect(LoginResponse.safeParse({ ok: true, token: 'abc' }).success).toBe(false);
  });

  it('refuses a workspace with an unknown status and a lockout without a time', () => {
    const me = { user, workspaces: [{ clientId: 'c1', name: 'X', status: 'paused' }] };
    expect(MeResponse.safeParse(me).success).toBe(false);
    expect(LoginLockedBody.safeParse({ error: 'LOGIN_LOCKED', message: 'm' }).success).toBe(false);
  });
});
