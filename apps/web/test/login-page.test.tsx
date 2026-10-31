import type { MeResponse } from '@reaplift/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createApi, type Api } from '../src/api';
import { createMockTransport } from '../src/api/mock';
import type { ApiRequest, Transport } from '../src/api/transport';
import { AuthProvider } from '../src/auth/AuthProvider';
import { Login } from '../src/pages/Login';

const PASSWORD = 'reaplift-dev-1';
const clock = new Date('2026-10-30T10:00:00.000Z');

function mount(api: Api) {
  const onLoggedIn = vi.fn<(me: MeResponse) => void>();
  render(
    <AuthProvider api={api}>
      <Login onLoggedIn={onLoggedIn} />
    </AuthProvider>,
  );
  return onLoggedIn;
}

async function signIn(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const alertText = async () => (await screen.findByRole('alert')).textContent;

describe('Login page', () => {
  it('has email and password only: no role field, nothing pre-filled', () => {
    mount(createApi(() => createMockTransport()));
    expect(screen.queryByLabelText('Role')).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('logs in and hands over the user and workspaces', async () => {
    const mock = createMockTransport();
    const onLoggedIn = mount(createApi(() => mock));
    await signIn('ops@northwind.com', PASSWORD);
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1));
    const me = onLoggedIn.mock.calls[0]![0];
    expect(me.user.email).toBe('ops@northwind.com');
    expect(me.workspaces.map((w) => w.name)).toEqual(['Northwind Labs']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "Wrong email or password." for a wrong password', async () => {
    const onLoggedIn = mount(createApi(() => createMockTransport()));
    await signIn('ops@northwind.com', 'not-the-password');
    expect(await alertText()).toBe('Wrong email or password.');
    expect(onLoggedIn).not.toHaveBeenCalled();
  });

  it('shows the same message for an unknown email', async () => {
    mount(createApi(() => createMockTransport()));
    await signIn('nobody@example.com', PASSWORD);
    expect(await alertText()).toBe('Wrong email or password.');
  });

  it('shows "Locked until hh:mm" after 10 failures, even for the right password', async () => {
    const mock = createMockTransport(() => clock);
    const api = createApi(() => mock);
    for (let i = 0; i < 10; i++) await api.login({ email: 'sales@greenleaf.in', password: 'wrong' }).catch(() => {});
    mount(api);
    await signIn('sales@greenleaf.in', PASSWORD);
    // The unlock time in this machine's own time zone, as the panel shows it.
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      new Date('2026-10-30T10:15:00.000Z'),
    );
    expect(await alertText()).toBe(`Too many failed logins. Locked until ${time}.`);
  });

  it('shows a connection message when the server cannot be reached', async () => {
    const down: Transport = async () => {
      throw new TypeError('Failed to fetch');
    };
    mount(createApi(() => down));
    await signIn('ops@northwind.com', PASSWORD);
    expect(await alertText()).toBe('Cannot reach the server. Check your connection and try again.');
  });

  it('sends the password exactly as typed (spaces kept) and the email trimmed', async () => {
    const mock = createMockTransport();
    const sent: ApiRequest[] = [];
    const spy: Transport = (req) => {
      sent.push(req);
      return mock(req);
    };
    mount(createApi(() => spy));
    await signIn('  ops@northwind.com  ', ' pass with spaces ');
    await screen.findByRole('alert');
    expect(sent.find((r) => r.path === '/api/auth/login')?.body).toEqual({
      email: 'ops@northwind.com',
      password: ' pass with spaces ',
    });
  });

  it('disables the button while signing in, and clears the old error on the next try', async () => {
    const mock = createMockTransport();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Transport = async (req) => {
      if (req.path === '/api/auth/login' && req.body && (req.body as { password: string }).password === PASSWORD) await gate;
      return mock(req);
    };
    mount(createApi(() => slow));

    await signIn('ops@northwind.com', 'wrong');
    expect(await alertText()).toBe('Wrong email or password.');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    release();
  });
});
