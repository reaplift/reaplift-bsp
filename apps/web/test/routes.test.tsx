import { render, screen, waitFor, within } from '@testing-library/react';
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

const where = () => screen.getByTestId('where').textContent;
const landsOn = (path: string) => waitFor(() => expect(where()).toBe(path));
const menu = () =>
  within(screen.getByRole('navigation'))
    .getAllByRole('link')
    .map((a) => `${a.textContent} ${a.getAttribute('href')}`);
const pickerNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

beforeEach(() => {
  // The prototype pages still call /api/ping and /api/admin/clients with fetch.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
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

describe('the worked example: where each user starts', () => {
  it('ops@northwind.com (one client) opens Northwind directly: no picker, no Admin', async () => {
    open('/', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
    expect(menu()).toEqual([`Dashboard ${NORTHWIND}/dashboard`, `Push campaign ${NORTHWIND}/campaign`]);
  });

  it('ops@northwind.com cannot open the picker; it sends them to their workspace', async () => {
    open('/workspaces', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('sales@greenleaf.in opens Greenleaf directly', async () => {
    open('/', await loggedInAs('sales@greenleaf.in'));
    await landsOn(`${GREENLEAF}/dashboard`);
  });

  it('meera@reaplift.com sees a picker with Bluebird and Northwind only, and no Admin', async () => {
    open('/', await loggedInAs('meera@reaplift.com'));
    await landsOn('/workspaces');
    expect(await screen.findByRole('heading', { name: 'Choose a client' })).toBeDefined();
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Northwind Labs']);
    expect(screen.queryByRole('link', { name: 'Open Admin' })).toBeNull();
  });

  it('meera picks Bluebird and the menu points at Bluebird', async () => {
    open('/', await loggedInAs('meera@reaplift.com'));
    await userEvent.click(await screen.findByRole('link', { name: 'Bluebird Retail' }));
    await landsOn(`${BLUEBIRD}/dashboard`);
    expect(menu()).toEqual([`Dashboard ${BLUEBIRD}/dashboard`, `Push campaign ${BLUEBIRD}/campaign`]);
  });

  it('ravi@reaplift.com sees all three clients and Open Admin, and Admin in the menu', async () => {
    open('/', await loggedInAs('ravi@reaplift.com'));
    await landsOn('/workspaces');
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Greenleaf Foods', 'Northwind Labs']);
    expect(menu()).toEqual(['Admin /admin']);
    await userEvent.click(screen.getByRole('link', { name: 'Open Admin' }));
    await landsOn('/admin');
    expect(await screen.findByRole('heading', { name: 'Client management' })).toBeDefined();
  });

  it('ravi inside a workspace has the workspace menu plus Admin', async () => {
    open(`${GREENLEAF}/campaign`, await loggedInAs('ravi@reaplift.com'));
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(menu()).toEqual([
      `Dashboard ${GREENLEAF}/dashboard`,
      `Push campaign ${GREENLEAF}/campaign`,
      'Admin /admin',
    ]);
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
    const mock = createMockTransport();
    const withSuspended: Transport = async (req) => {
      const res = await mock(req);
      if (req.path === '/api/auth/me' && res.status === 200) {
        const body = res.body as { workspaces: { name: string; status: string }[] };
        for (const w of body.workspaces) if (w.name === 'Greenleaf Foods') w.status = 'suspended';
      }
      return res;
    };
    open('/', await loggedInAs('ravi@reaplift.com', withSuspended));
    await landsOn('/workspaces');
    expect(pickerNames()).toEqual(['Bluebird Retail', 'Greenleaf Foods Suspended', 'Northwind Labs']);
    expect(screen.queryByRole('link', { name: /Greenleaf/ })).toBeNull();
  });

  it("typing a suspended client's address does not open it either", async () => {
    const mock = createMockTransport();
    const withSuspended: Transport = async (req) => {
      const res = await mock(req);
      if (req.path === '/api/auth/me' && res.status === 200) {
        const body = res.body as { workspaces: { name: string; status: string }[] };
        for (const w of body.workspaces) if (w.name === 'Greenleaf Foods') w.status = 'suspended';
      }
      return res;
    };
    open(`${GREENLEAF}/dashboard`, await loggedInAs('ravi@reaplift.com', withSuspended));
    await landsOn('/workspaces');
  });
});

describe('inside a workspace', () => {
  it('a reload of a workspace page stays on it', async () => {
    open(`${BLUEBIRD}/campaign`, await loggedInAs('meera@reaplift.com'));
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(where()).toBe(`${BLUEBIRD}/campaign`);
  });

  it('an unknown page inside a workspace goes to its dashboard', async () => {
    open(`${NORTHWIND}/no-such-page`, await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });

  it('clicking a menu link changes the page and marks the link active', async () => {
    open(`${NORTHWIND}/dashboard`, await loggedInAs('ops@northwind.com'));
    const link = await screen.findByRole('link', { name: 'Push campaign' });
    await userEvent.click(link);
    await landsOn(`${NORTHWIND}/campaign`);
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(link.className).toBe('nav-item active');
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).toBe('nav-item');
  });

  it('a logged-in user opening /login is sent home', async () => {
    open('/login', await loggedInAs('ops@northwind.com'));
    await landsOn(`${NORTHWIND}/dashboard`);
  });
});

describe('logging in through the page', () => {
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
});
