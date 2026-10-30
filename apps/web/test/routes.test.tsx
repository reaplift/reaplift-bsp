import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, type Api } from '../src/api';
import { createMockTransport } from '../src/api/mock';
import type { Transport } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';

const PASSWORD = 'reaplift-dev-1';

/** Shows the current address, so a test can check where a redirect landed. */
function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function open(path: string, api: Api) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider api={api}>
        <App />
      </AuthProvider>
      <Where />
    </MemoryRouter>,
  );
}

/** An API over a mock server where `email` already has a session, like a reload after login. */
async function loggedInAs(email: string): Promise<Api> {
  const mock = createMockTransport();
  const api = createApi(() => mock);
  await api.login({ email, password: PASSWORD });
  return api;
}

const loggedOut = (): Api => {
  const mock = createMockTransport();
  return createApi(() => mock);
};

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  // The prototype pages still call /api/ping and /api/admin/clients with fetch.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routes, logged out', () => {
  it.each(['/', '/dashboard', '/campaign', '/admin', '/no-such-page'])('%s goes to /login', async (path) => {
    open(path, loggedOut());
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeDefined();
    expect(where()).toBe('/login');
  });

  it('shows the server error and Try again, not the login page, when /me cannot be reached', async () => {
    let up = false;
    const mock = createMockTransport();
    const flaky: Transport = async (req) => {
      if (!up) throw new TypeError('Failed to fetch');
      return mock(req);
    };
    open('/dashboard', createApi(() => flaky));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(screen.queryByRole('heading', { name: 'Login' })).toBeNull();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeDefined();
  });
});

describe('routes, logged in', () => {
  it('a client opens / on the dashboard', async () => {
    open('/', await loggedInAs('ops@northwind.com'));
    expect(await screen.findByRole('heading', { name: 'Recent campaigns' })).toBeDefined();
    expect(where()).toBe('/dashboard');
  });

  it('a super admin opens / on admin', async () => {
    open('/', await loggedInAs('ravi@reaplift.com'));
    expect(await screen.findByRole('heading', { name: 'Client management' })).toBeDefined();
    expect(where()).toBe('/admin');
  });

  it('a reload of /campaign stays on /campaign (the session is checked before routing)', async () => {
    open('/campaign', await loggedInAs('meera@reaplift.com'));
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(where()).toBe('/campaign');
  });

  it('a client typing /admin is sent to the dashboard', async () => {
    open('/admin', await loggedInAs('ops@northwind.com'));
    expect(await screen.findByRole('heading', { name: 'Recent campaigns' })).toBeDefined();
    expect(where()).toBe('/dashboard');
  });

  it('an unknown address goes to the home page', async () => {
    open('/no-such-page', await loggedInAs('ops@northwind.com'));
    await waitFor(() => expect(where()).toBe('/dashboard'));
  });

  it('a logged-in user opening /login is sent home', async () => {
    open('/login', await loggedInAs('ops@northwind.com'));
    await waitFor(() => expect(where()).toBe('/dashboard'));
  });

  it('clicking a menu link changes the address and the page, and marks the link active', async () => {
    open('/dashboard', await loggedInAs('ops@northwind.com'));
    const link = await screen.findByRole('link', { name: 'Push campaign' });
    await userEvent.click(link);
    expect(where()).toBe('/campaign');
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(link.className).toBe('nav-item active');
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).toBe('nav-item');
  });

  it('shows one menu link per page the role may open', async () => {
    open('/dashboard', await loggedInAs('ops@northwind.com'));
    await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/campaign', '/login']);
  });
});

describe('login through the page', () => {
  it('signing in as a client lands on the dashboard', async () => {
    open('/login', loggedOut());
    await userEvent.type(await screen.findByLabelText('Email'), 'ops@northwind.com');
    await userEvent.type(screen.getByLabelText('Password'), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Recent campaigns' })).toBeDefined();
    expect(where()).toBe('/dashboard');
  });
});
