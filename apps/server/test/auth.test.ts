import { describe, expect, it } from 'vitest';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from '../src/lib/auth.js';
import { classifyRoute } from '../src/modules/auth/scope.js';
import { createUser, UserInputError } from '../src/modules/auth/users.js';
import { unusedDb } from './support/unused-db.js';

describe('passwords', () => {
  it('hashes with argon2id, never keeps the password, and salts every hash', async () => {
    const first = await hashPassword('StrongPass!123');
    const second = await hashPassword('StrongPass!123');

    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toContain('StrongPass!123');
    expect(first).not.toBe(second);
    expect(await verifyPassword('StrongPass!123', first)).toBe(true);
    expect(await verifyPassword('wrong-pass', first)).toBe(false);
  });

  it('fails without a stored hash (unknown email)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });
});

describe('session tokens', () => {
  it('creates a random token and a stable hash for storage', () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });
});

describe('createUser rules', () => {
  const base = { email: 'a@b.com', name: 'A', password: 'long-enough-1' };

  it('refuses a client user without a client', async () => {
    await expect(createUser(unusedDb(), { ...base, role: 'client' })).rejects.toThrow(
      UserInputError,
    );
  });

  it('refuses a super admin or staff user with a client', async () => {
    const clientId = '00000000-0000-0000-0000-000000000001';
    await expect(createUser(unusedDb(), { ...base, role: 'staff', clientId })).rejects.toThrow(
      UserInputError,
    );
    await expect(
      createUser(unusedDb(), { ...base, role: 'super_admin', clientId }),
    ).rejects.toThrow(UserInputError);
  });

  it('refuses a short password', async () => {
    await expect(
      createUser(unusedDb(), { ...base, role: 'super_admin', password: 'short' }),
    ).rejects.toThrow(UserInputError);
  });
});

describe('route access rules', () => {
  it('classifies every route pattern', () => {
    expect(classifyRoute('/healthz')).toBe('public');
    expect(classifyRoute('/api/auth/login')).toBe('public');
    expect(classifyRoute('/api/auth/me')).toBe('session');
    expect(classifyRoute('/api/clients/:clientId')).toBe('client');
    expect(classifyRoute('/api/clients/:clientId/templates')).toBe('client');
    expect(classifyRoute('/api/admin/clients')).toBe('admin');
    expect(classifyRoute('/api/me/password')).toBe('me');
    expect(classifyRoute('/api/ping')).toBe('unscoped');
    expect(classifyRoute('/api/clientsX')).toBe('unscoped');
  });
});
