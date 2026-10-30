import { describe, expect, it } from 'vitest';
import { canManageClients, type UserRole } from '@reaplift/shared';

describe('client user capability', () => {
  it('lets super admin manage clients', () => {
    const role: UserRole = 'super_admin';

    expect(canManageClients(role)).toBe(true);
  });

  it('blocks client user from managing clients', () => {
    const role: UserRole = 'client';

    expect(canManageClients(role)).toBe(false);
  });
});
