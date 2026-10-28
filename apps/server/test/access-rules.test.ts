import { describe, expect, it } from 'vitest';
import { canAccessPage, type UserRole } from '@reaplift/shared';

describe('role-based page access', () => {
  it('allows the super admin to access the admin console and dashboard', () => {
    const role: UserRole = 'super_admin';

    expect(canAccessPage(role, 'admin')).toBe(true);
    expect(canAccessPage(role, 'dashboard')).toBe(true);
    expect(canAccessPage(role, 'campaign')).toBe(true);
  });

  it('blocks a client admin from the admin console', () => {
    const role: UserRole = 'client_admin';

    expect(canAccessPage(role, 'admin')).toBe(false);
    expect(canAccessPage(role, 'dashboard')).toBe(true);
    expect(canAccessPage(role, 'campaign')).toBe(true);
  });

  it('shows audience lists only to the super admin until sessions carry a client (M2.2)', () => {
    expect(canAccessPage('super_admin', 'lists')).toBe(true);
    expect(canAccessPage('client_admin', 'lists')).toBe(false);
    expect(canAccessPage('staff', 'lists')).toBe(false);
    expect(canAccessPage(null, 'lists')).toBe(false);
  });

  it('keeps the login route available to unauthenticated users', () => {
    expect(canAccessPage(null, 'login')).toBe(true);
    expect(canAccessPage(undefined, 'login')).toBe(true);
  });
});
