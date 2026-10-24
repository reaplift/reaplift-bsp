import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  hashPassword,
  hashToken,
  isSessionExpired,
  verifyPassword,
} from '../src/lib/auth.js';

describe('auth helpers', () => {
  it('hashes passwords and verifies the original input', () => {
    const raw = 'StrongPass!123';
    const first = hashPassword(raw);
    const second = hashPassword(raw);

    expect(first).not.toBe(second);
    expect(verifyPassword(raw, first)).toBe(true);
    expect(verifyPassword('wrong-pass', first)).toBe(false);
  });

  it('creates a session token and a stable hash for storage', () => {
    const token = createSessionToken();
    const hash = hashToken(token);

    expect(token.length).toBeGreaterThan(32);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });

  it('marks expired sessions correctly', () => {
    expect(isSessionExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isSessionExpired(new Date(Date.now() + 1000))).toBe(false);
  });
});
