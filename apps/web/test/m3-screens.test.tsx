import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import type { ApiRequest, ApiResponse } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';

const ME = {
  user: { id: 'u1', name: 'Ravi', email: 'ravi@reaplift.com', role: 'super_admin' },
  workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }],
};
const CLIENT = {
  id: 'c1',
  name: 'Northwind Labs',
  status: 'active',
  countryCallingCode: '91',
  contactEmail: 'ops@northwind.com',
  lowBalanceAlertPaise: null,
  balancePaise: 123450,
  onHoldPaise: 5000,
};
const fail = (status: number, error: string, message = error): ApiResponse => ({ status, body: { error, message } });

/** A server answering from a table; records every call so a test can check what the screen sent. */
function serverWith(routes: Record<string, (body: unknown) => ApiResponse>) {
  const calls: ApiRequest[] = [];
  const transport = async (request: ApiRequest): Promise<ApiResponse> => {
    calls.push(request);
    const handler = routes[`${request.method} ${request.path}`];
    if (handler) return handler(request.body);
    if (request.path === '/api/me/notifications') return { status: 200, body: { items: [], nextCursor: null, unreadCount: 0 } };
    return fail(404, 'NOT_FOUND', `no route ${request.method} ${request.path}`);
  };
  return { calls, api: createApi(() => transport) };
}

const open = (path: string, routes: Record<string, (body: unknown) => ApiResponse>) => {
  const server = serverWith({ 'GET /api/auth/me': () => ({ status: 200, body: ME }), ...routes });
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider api={server.api}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return server;
};
const sent = (server: { calls: ApiRequest[] }, method: string, path: string) =>
  server.calls.find((c) => c.method === method && c.path === path);

afterEach(cleanup);

describe('S3 password', () => {
  it('a first password shows only the change form; the new password must match; then the panel opens', async () => {
    let changed = false;
    const server = open('/', {
      'GET /api/auth/me': () => (changed ? { status: 200, body: ME } : fail(403, 'PASSWORD_CHANGE_REQUIRED')),
      'POST /api/me/password': () => {
        changed = true;
        return { status: 200, body: { changed: true } };
      },
    });
    await screen.findByRole('heading', { name: 'Choose a new password' });
    expect(screen.queryByRole('navigation')).toBeNull();

    await userEvent.type(screen.getByLabelText('Current password'), 'Temp-4821-north');
    await userEvent.type(screen.getByLabelText(/^New password/), 'Asha-chose-this-1');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'something-else-1');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
    expect(sent(server, 'POST', '/api/me/password')).toBeUndefined();

    await userEvent.clear(screen.getByLabelText('Repeat new password'));
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'Asha-chose-this-1');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('navigation');
    expect(sent(server, 'POST', '/api/me/password')?.body).toEqual({
      currentPassword: 'Temp-4821-north',
      newPassword: 'Asha-chose-this-1',
    });
  });

  it('a wrong current password shows the error and stays on the form', async () => {
    open('/account', { 'POST /api/me/password': () => fail(401, 'INVALID_CREDENTIALS') });
    await userEvent.type(await screen.findByLabelText('Current password'), 'wrong-password');
    await userEvent.type(screen.getByLabelText(/^New password/), 'Asha-chose-this-1');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'Asha-chose-this-1');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Wrong email or password');
  });
});

describe('S4 clients', () => {
  it('lists clients with money from paise, and adds one with India fixed', async () => {
    const server = open('/admin/clients', {
      'GET /api/admin/clients': () => ({ status: 200, body: { items: [CLIENT], nextCursor: null } }),
      'POST /api/admin/clients': () => ({ status: 201, body: { ...CLIENT, id: 'c2', name: 'New Co' } }),
    });
    await screen.findByRole('link', { name: 'Northwind Labs' });
    expect(screen.getByText('₹1,234.50')).toBeTruthy();
    expect(screen.getByText('₹50.00')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Name'), 'New Co');
    await userEvent.type(screen.getByLabelText('Contact email'), 'a@new.co');
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));
    await waitFor(() =>
      expect(sent(server, 'POST', '/api/admin/clients')?.body).toEqual({ name: 'New Co', countryCallingCode: '91', contactEmail: 'a@new.co' }),
    );
  });

  it('shows a taken name in words', async () => {
    open('/admin/clients', {
      'GET /api/admin/clients': () => ({ status: 200, body: { items: [], nextCursor: null } }),
      'POST /api/admin/clients': () => fail(409, 'CLIENT_NAME_TAKEN'),
    });
    await userEvent.type(await screen.findByLabelText('Name'), 'Northwind');
    await userEvent.type(screen.getByLabelText('Contact email'), 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: 'Add client' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A client already has this name.');
  });

  const detail = { ...CLIENT, users: [{ id: 'u2', name: 'Asha', email: 'asha@n.com', role: 'client', status: 'active' }], staff: [] };

  it('suspending needs a note', async () => {
    const server = open('/admin/clients/c1', {
      'GET /api/admin/clients/c1': () => ({ status: 200, body: detail }),
      'POST /api/admin/clients/c1/suspend': () => ({ status: 200, body: {} }),
    });
    const button = await screen.findByRole('button', { name: 'Suspend client' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Note (required)'), 'invoice overdue');
    await userEvent.click(button);
    await waitFor(() => expect(sent(server, 'POST', '/api/admin/clients/c1/suspend')?.body).toEqual({ note: 'invoice overdue' }));
  });

  it('creates a login, disables a user, and resets a password', async () => {
    const server = open('/admin/clients/c1', {
      'GET /api/admin/clients/c1': () => ({ status: 200, body: detail }),
      'POST /api/admin/users': () => ({ status: 201, body: {} }),
      'PATCH /api/admin/users/u2': () => ({ status: 200, body: {} }),
      'POST /api/admin/users/u2/reset-password': () => ({ status: 200, body: {} }),
    });
    await screen.findByText('asha@n.com');
    await userEvent.type(screen.getAllByLabelText('Name')[1]!, 'Bob');
    await userEvent.type(screen.getByLabelText('Email'), 'bob@n.com');
    const first = screen.getByLabelText(/^First password/) as HTMLInputElement;
    expect(first.type).toBe('password');
    await userEvent.type(first, 'first-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Add login' }));
    await waitFor(() =>
      expect(sent(server, 'POST', '/api/admin/users')?.body).toEqual({
        name: 'Bob',
        email: 'bob@n.com',
        role: 'client',
        clientId: 'c1',
        password: 'first-password-1',
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(sent(server, 'PATCH', '/api/admin/users/u2')?.body).toEqual({ status: 'disabled' }));

    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const reset = screen.getByLabelText(/^New first password for Asha/) as HTMLInputElement;
    expect(reset.type).toBe('password');
    await userEvent.type(reset, 'second-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() =>
      expect(sent(server, 'POST', '/api/admin/users/u2/reset-password')?.body).toEqual({ password: 'second-password-1' }),
    );
  });

  it('saving staff assignments sends the whole new list', async () => {
    const person = { id: 's1', name: 'Meera', email: 'm@r.com', role: 'staff', status: 'active', clientId: null, lastLoginAt: null, assignedClientIds: [] };
    const server = open('/admin/staff', {
      'GET /api/admin/users?role=staff': () => ({ status: 200, body: { items: [person], nextCursor: null } }),
      'GET /api/admin/clients': () => ({ status: 200, body: { items: [CLIENT], nextCursor: null } }),
      'PUT /api/admin/users/s1/clients': () => ({ status: 200, body: {} }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Assign clients' }));
    const row = screen.getAllByLabelText('Northwind Labs')[0]!;
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent(server, 'PUT', '/api/admin/users/s1/clients')?.body).toEqual({ clientIds: ['c1'] }));
  });
});

describe('S5 audit and S6 notifications', () => {
  const row = { id: 9, clientId: 'c1', userId: 'u1', userName: 'Ravi', action: 'client.suspended', entityType: 'client', entityId: 'c1', details: { note: 'unpaid' }, createdAt: '2026-11-01T10:00:00Z' };

  it('filters the audit log, using whole days in India time, and pages', async () => {
    const server = open('/admin/audit', {
      'GET /api/admin/clients': () => ({ status: 200, body: { items: [CLIENT], nextCursor: null } }),
      'GET /api/admin/users': () => ({ status: 200, body: { items: [], nextCursor: null } }),
      'GET /api/admin/audit': () => ({ status: 200, body: { items: [row], nextCursor: '9' } }),
      'GET /api/admin/audit?cursor=9': () => ({ status: 200, body: { items: [{ ...row, id: 8, action: 'client.created' }], nextCursor: null } }),
    });
    await screen.findByText('client.suspended');
    expect(screen.getByText('01 Nov 2026, 15:30')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText('client.created');

    await userEvent.type(screen.getByLabelText('Action'), 'client.created');
    await userEvent.type(screen.getByLabelText('From'), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => {
      const last = server.calls.filter((c) => c.path.startsWith('/api/admin/audit')).at(-1)!.path;
      expect(last).toContain('action=client.created');
      expect(decodeURIComponent(last)).toContain('from=2026-11-01T00:00:00+05:30');
    });
  });

  it('the bell shows the unread count and marks one read', async () => {
    let read = false;
    const server = open('/account', {
      'GET /api/me/notifications': () => ({
        status: 200,
        body: {
          items: [{ id: 'n1', event: 'staff.assigned', subject: 'Your ReapLift clients have changed', text: 'You are now assigned to: Northwind Labs.', readAt: read ? '2026-11-01T10:00:00Z' : null, createdAt: '2026-11-01T10:00:00Z' }],
          nextCursor: null,
          unreadCount: read ? 0 : 1,
        },
      }),
      'PATCH /api/me/notifications/n1/read': () => {
        read = true;
        return { status: 200, body: {} };
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Notifications\s*1$/ }));
    await userEvent.click(screen.getByRole('button', { name: /assigned to: Northwind Labs/ }));
    await screen.findByRole('button', { name: 'Notifications' });
    expect(sent(server, 'PATCH', '/api/me/notifications/n1/read')).toBeTruthy();
  });

  it('the delivery log filters by status', async () => {
    const server = open('/admin/delivery-log', {
      'GET /api/admin/notifications': () => ({ status: 200, body: { items: [{ id: 'd1', email: 'a@b.co', event: 'user.created', channel: 'email', status: 'failed', attempts: 3, lastError: 'SMTP down', sentAt: null, createdAt: '2026-11-01T10:00:00Z' }], nextCursor: null } }),
      'GET /api/admin/notifications?status=failed': () => ({ status: 200, body: { items: [], nextCursor: null } }),
    });
    await screen.findByText('SMTP down');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed');
    await screen.findByText('Nothing matches.');
    expect(sent(server, 'GET', '/api/admin/notifications?status=failed')).toBeTruthy();
  });

  it('a client user cannot open any admin page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = open('/admin/audit', {
      'GET /api/auth/me': () => ({ status: 200, body: { ...ME, user: { ...ME.user, role: 'client' } } }),
    });
    await screen.findByRole('navigation');
    expect(server.calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('things found on review', () => {
  it('no password on any screen shows by default, on the staff page either', async () => {
    const person = { id: 's1', name: 'Meera', email: 'm@r.com', role: 'staff', status: 'active', clientId: null, lastLoginAt: null, assignedClientIds: [] };
    open('/admin/staff', {
      'GET /api/admin/users?role=staff': () => ({ status: 200, body: { items: [person], nextCursor: null } }),
      'GET /api/admin/clients': () => ({ status: 200, body: { items: [CLIENT], nextCursor: null } }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    for (const label of [/^First password/, /^New first password for Meera/]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).type).toBe('password');
    }
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2);
  });

  it('the eye button shows and hides a password, and the rule is on screen before any failure', async () => {
    open('/account', {});
    const field = (await screen.findByLabelText(/^New password/)) as HTMLInputElement;
    expect(screen.getByText(/At least 10 characters, different from your current password/)).toBeTruthy();
    expect(field.type).toBe('password');
    const eyes = screen.getAllByRole('button', { name: 'Show password' });
    expect(eyes).toHaveLength(3);
    await userEvent.click(eyes[1]!);
    expect(field.type).toBe('text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field.type).toBe('password');
  });

  it('the audit and delivery logs explain themselves', async () => {
    open('/admin/delivery-log', { 'GET /api/admin/notifications': () => ({ status: 200, body: { items: [], nextCursor: null } }) });
    expect((await screen.findByRole('note')).getAttribute('aria-label')).toContain('whether it went out');
  });
});
