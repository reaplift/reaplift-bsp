import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
const NORTHWIND = '/clients/client-northwind';
const BLUEBIRD = '/clients/client-bluebird';
const GREENLEAF = '/clients/client-greenleaf';
const WORKSPACE_MENU = ['Dashboard', 'Push Campaign', 'Templates', 'Reports', 'Wallet', 'Settings'];

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
async function loggedInAs(email: string, transport: Transport = createMockTransport()): Promise<Api> {
  const api = createApi(() => transport);
  await api.login({ email, password: PASSWORD });
  return api;
}

const loggedOut = (): Api => {
  const mock = createMockTransport();
  return createApi(() => mock);
};

/** Marks Greenleaf suspended in /me answers. */
function withGreenleafSuspended(): Transport {
  const mock = createMockTransport();
  return async (req) => {
    const res = await mock(req);
    if (req.path === '/api/auth/me' && res.status === 200) {
      const body = res.body as { workspaces: { name: string; status: string }[] };
      for (const w of body.workspaces) if (w.name === 'Greenleaf Foods') w.status = 'suspended';
    }
    return res;
  };
}

const where = () => screen.getByTestId('where').textContent;
const landsOn = (path: string) => waitFor(() => expect(where()).toBe(path));
const menuLinks = () => within(screen.getByRole('navigation')).getAllByRole('link');
const menuLabels = () => menuLinks().map((a) => a.textContent);
const menuHrefs = () => menuLinks().map((a) => a.getAttribute('href'));
const pageTitle = () => screen.getByRole('heading', { level: 1 }).textContent;
const sectionTitle = () => screen.getByRole('heading', { level: 2 }).textContent;
const pickerNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

// Rule 1 of the screens track: no screen calls fetch directly; everything goes through the API
// layer (here backed by the mock). Any direct fetch fails the test that caused it.
const directFetch = vi.fn(async () => new Response('{}', { status: 500 }));
beforeEach(() => {
  vi.stubGlobal('fetch', directFetch);
});
afterEach(() => {
  // Unmount and reset before checking, so a failure here cannot leave this test's screen or call
  // count behind to fail the tests after it.
  cleanup();
  const calls = directFetch.mock.calls.length;
  directFetch.mockClear();
  vi.unstubAllGlobals();
  expect(calls, 'a screen called fetch directly instead of the API layer').toBe(0);
});

describe('logged out', () => {
  it.each(['/', '/workspaces', `${NORTHWIND}/dashboard`, '/admin', '/no-such-page'])(
    '%s goes to /login, with no menu',
    async (path) => {
      open(path, loggedOut());
      expect(await screen.findByRole('heading', { name: 'Login' })).toBeDefined();
      expect(where()).toBe('/login');
      expect(screen.queryByRole('navigation')).toBeNull();
    },
  );

  it('shows the server error and Try again, not the login page, when /me cannot be reached', async () => {
    let up = false;
    const mock = createMockTransport();
    const flaky: Transport = async (req) => {
      if (!up) throw new TypeError('Failed to fetch');
      return mock(req);
    };
    open('/', createApi(() => flaky));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(screen.queryByRole('heading', { name: 'Login' })).toBeNull();
    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeDefined();
  });
});

describe('the worked example: what each user sees', () => {
  it('ops@northwind.com opens Northwind directly: workspace menu, no Admin, no Switch', async () => {
    open('/', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
    expect(pageTitle()).toBe('Northwind Labs');
    expect(menuLabels()).toEqual(WORKSPACE_MENU);
    expect(menuHrefs()).toEqual(
      ['dashboard', 'campaign', 'templates', 'reports', 'wallet', 'settings'].map((p) => `${NORTHWIND}/${p}`),
    );
    expect(screen.queryByRole('link', { name: 'Switch client' })).toBeNull();
    expect(screen.getByText('Northwind Ops')).toBeDefined();
  });

  it('ops@northwind.com cannot open the picker; it sends them to their workspace', async () => {
    open('/workspaces', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('sales@greenleaf.in opens Greenleaf directly', async () => {
    open('/', await loggedInAs('sales@greenleaf.in'));
    await landsOn(`${GREENLEAF}/dashboard`);
    expect(pageTitle()).toBe('Greenleaf Foods');
    expect(menuLabels()).toEqual(WORKSPACE_MENU);
  });

  it('meera@reaplift.com sees a picker with Bluebird and Northwind only, and no Admin', async () => {
    open('/', await loggedInAs('meera@reaplift.com'));
    await landsOn('/workspaces');
    expect(pageTitle()).toBe('Choose a client');
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Northwind Labs']);
    expect(screen.queryByRole('link', { name: 'Open Admin' })).toBeNull();
    expect(screen.queryByRole('navigation')?.textContent ?? '').not.toContain('Admin');
  });

  it('meera picks Bluebird: Bluebird in the header, the menu points at Bluebird, and she can switch', async () => {
    open('/', await loggedInAs('meera@reaplift.com'));
    await userEvent.click(await screen.findByRole('link', { name: 'Bluebird Retail' }));
    await landsOn(`${BLUEBIRD}/dashboard`);
    expect(pageTitle()).toBe('Bluebird Retail');
    expect(menuLabels()).toEqual(WORKSPACE_MENU);
    expect(menuHrefs()[0]).toBe(`${BLUEBIRD}/dashboard`);
    await userEvent.click(screen.getByRole('link', { name: 'Switch client' }));
    await landsOn('/workspaces');
    await userEvent.click(screen.getByRole('link', { name: 'Northwind Labs' }));
    await landsOn(`${NORTHWIND}/dashboard`);
    expect(pageTitle()).toBe('Northwind Labs');
  });

  it('ravi@reaplift.com sees all three clients, Open Admin, and Admin in the menu', async () => {
    open('/', await loggedInAs('ravi@reaplift.com'));
    await landsOn('/workspaces');
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Greenleaf Foods', 'Northwind Labs']);
    expect(menuLabels()).toEqual(['Admin']);
    await userEvent.click(screen.getByRole('link', { name: 'Open Admin' }));
    await landsOn('/admin');
    expect(pageTitle()).toBe('Administration');
    expect(sectionTitle()).toBe('Admin');
    expect(screen.getByText('This page is coming soon.')).toBeDefined();
  });

  it('ravi inside a workspace has the workspace menu plus Admin, and can switch', async () => {
    open(`${GREENLEAF}/campaign`, await loggedInAs('ravi@reaplift.com'));
    await screen.findByRole('heading', { name: 'Push Campaign' });
    expect(menuLabels()).toEqual([...WORKSPACE_MENU, 'Admin']);
    expect(screen.getByRole('link', { name: 'Switch client' })).toBeDefined();
  });
});

describe('workspace pages', () => {
  it.each([
    ['dashboard', 'Dashboard', 'No campaign activity yet. Figures appear here once campaigns are sent.'],
    ['campaign', 'Push Campaign', 'No campaigns yet. Creating campaigns is coming soon.'],
    ['templates', 'Templates', 'This page is coming soon.'],
    ['reports', 'Reports', 'This page is coming soon.'],
    ['wallet', 'Wallet', 'This page is coming soon.'],
    ['settings', 'Settings', 'This page is coming soon.'],
  ])('%s shows "%s" and its empty or coming-soon text, and is marked active', async (page, title, text) => {
    open(`${NORTHWIND}/${page}`, await loggedInAs('ops@northwind.com'));
    expect(await screen.findByRole('heading', { level: 2, name: title })).toBeDefined();
    expect(screen.getByText(text)).toBeDefined();
    expect(screen.getByRole('link', { name: title }).className).toBe('nav-item active');
  });

  it('the dashboard shows none of the old prototype figures', async () => {
    open(`${NORTHWIND}/dashboard`, await loggedInAs('ops@northwind.com'));
    await screen.findByRole('heading', { level: 2, name: 'Dashboard' });
    for (const old of ['14,500', '13,880', 'Welcome sequence', 'Backend message']) {
      expect(screen.queryByText(old)).toBeNull();
    }
  });

  it('a reload of a workspace page stays on it', async () => {
    open(`${BLUEBIRD}/wallet`, await loggedInAs('meera@reaplift.com'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Wallet' })).toBeDefined();
    expect(where()).toBe(`${BLUEBIRD}/wallet`);
  });

  it('an unknown page inside a workspace goes to its dashboard', async () => {
    open(`${NORTHWIND}/no-such-page`, await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('clicking a menu link changes the page and moves the active mark', async () => {
    open(`${NORTHWIND}/dashboard`, await loggedInAs('ops@northwind.com'));
    await userEvent.click(await screen.findByRole('link', { name: 'Reports' }));
    await landsOn(`${NORTHWIND}/reports`);
    expect(screen.getByRole('link', { name: 'Reports' }).className).toBe('nav-item active');
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).toBe('nav-item');
  });
});

describe('a client the user may not open', () => {
  it("meera typing Greenleaf's address is sent to her picker", async () => {
    open(`${GREENLEAF}/dashboard`, await loggedInAs('meera@reaplift.com'));
    await landsOn('/workspaces');
    expect(screen.queryByText('Greenleaf Foods')).toBeNull();
  });

  it("ops@northwind.com typing Greenleaf's address is sent back to Northwind", async () => {
    open(`${GREENLEAF}/campaign`, await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('a client id that does not exist goes to the picker for staff', async () => {
    open('/clients/no-such-client/dashboard', await loggedInAs('meera@reaplift.com'));
    await landsOn('/workspaces');
  });

  it('a client user typing /admin goes home', async () => {
    open('/admin', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('a suspended client is shown in the picker but cannot be opened', async () => {
    open('/', await loggedInAs('ravi@reaplift.com', withGreenleafSuspended()));
    await landsOn('/workspaces');
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Greenleaf Foods Suspended', 'Northwind Labs']);
    expect(screen.queryByRole('link', { name: /Greenleaf/ })).toBeNull();
  });

  it("typing a suspended client's address does not open it either", async () => {
    open(`${GREENLEAF}/dashboard`, await loggedInAs('ravi@reaplift.com', withGreenleafSuspended()));
    await landsOn('/workspaces');
  });
});

describe('logging in and out through the page', () => {
  it.each([
    ['ops@northwind.com', `${NORTHWIND}/dashboard`],
    ['meera@reaplift.com', '/workspaces'],
    ['ravi@reaplift.com', '/workspaces'],
  ])('%s lands on %s', async (email, path) => {
    open('/login', loggedOut());
    await userEvent.type(await screen.findByLabelText('Email'), email);
    await userEvent.type(screen.getByLabelText('Password'), PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await landsOn(path);
  });

  it('a logged-in user opening /login is sent home', async () => {
    open('/login', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('Log out ends the session on the server and returns to /login', async () => {
    const api = await loggedInAs('meera@reaplift.com');
    open(`${BLUEBIRD}/dashboard`, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await landsOn('/login');
    expect(screen.queryByRole('navigation')).toBeNull();
    // The server-side session is gone too, not just the panel's state.
    await expect(api.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('a failed logout says so and keeps the user where they were', async () => {
    const mock = createMockTransport();
    let down = false;
    const transport: Transport = async (req) => {
      if (down) throw new TypeError('Failed to fetch');
      return mock(req);
    };
    open(`${NORTHWIND}/dashboard`, await loggedInAs('ops@northwind.com', transport));
    await screen.findByRole('heading', { level: 2, name: 'Dashboard' });
    down = true;
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
    expect(where()).toBe(`${NORTHWIND}/dashboard`);
  });
});
