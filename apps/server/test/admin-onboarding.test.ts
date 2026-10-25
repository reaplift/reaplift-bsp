import { describe, expect, it } from 'vitest';
import { canManageClients, type UserRole } from '@reaplift/shared';
import { buildApp } from '../src/app.js';

describe('client admin capability', () => {
  it('lets super admin manage clients', () => {
    const role: UserRole = 'super_admin';

    expect(canManageClients(role)).toBe(true);
  });

  it('blocks client admin from managing clients', () => {
    const role: UserRole = 'client_admin';

    expect(canManageClients(role)).toBe(false);
  });
});

describe('admin client API', () => {
  it('lists current clients', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const res = await app.inject({ method: 'GET', url: '/api/admin/clients' });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it('creates a client through the API', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      payload: {
        name: 'Northwind Labs',
        contactEmail: 'ops@northwind.com',
        assignedStaff: 'Aisha Shah',
        status: 'active',
        walletBalance: 250000,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Northwind Labs',
      contactEmail: 'ops@northwind.com',
      assignedStaff: 'Aisha Shah',
      status: 'active',
      walletBalance: 250000,
    });
  });

  it('updates a client status through the API', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      payload: {
        name: 'Orbit Commerce',
        contactEmail: 'ops@orbit.in',
        assignedStaff: 'Mira Nair',
        status: 'active',
        walletBalance: 90000,
      },
    });

    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/clients/${id}/status`,
      payload: { status: 'suspended' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      name: 'Orbit Commerce',
      status: 'suspended',
    });
  });

  it('updates client staff assignment through the API', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/clients',
      payload: {
        name: 'Facet Studio',
        contactEmail: 'ops@facet.studio',
        assignedStaff: 'Aisha Shah',
        status: 'active',
        walletBalance: 150000,
      },
    });

    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/clients/${id}/staff`,
      payload: { assignedStaff: 'Rahul S' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      name: 'Facet Studio',
      assignedStaff: 'Rahul S',
    });
  });

  it('rejects invalid login credentials', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@reaplift.ai',
        password: 'wrong-pass',
        role: 'super_admin',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'invalid credentials' });
  });

  it('accepts a valid login for an admin user', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'admin@reaplift.ai',
        password: 'password123',
        role: 'super_admin',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      user: { email: 'admin@reaplift.ai', role: 'super_admin' },
    });
  });
});
