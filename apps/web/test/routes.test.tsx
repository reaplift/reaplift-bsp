import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ROUTER_FUTURE } from '../src/components/Layout';

/** Shows the current address, so a test can check where a redirect landed. */
function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

const loggedInAs = (role: string) =>
  localStorage.setItem('reaplift-session', JSON.stringify({ email: 'x@y.in', role, token: 't' }));
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  // The pages call /api/ping and /api/admin/clients on mount; answer with something harmless.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('routes, logged out', () => {
  it.each(['/', '/dashboard', '/campaign', '/admin', '/no-such-page'])('%s goes to /login', async (path) => {
    open(path);
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeDefined();
    expect(where()).toBe('/login');
  });
});

describe('routes, logged in', () => {
  it('a client opens / on the dashboard', async () => {
    loggedInAs('client');
    open('/');
    expect(await screen.findByRole('heading', { name: 'Recent campaigns' })).toBeDefined();
    expect(where()).toBe('/dashboard');
  });

  it('a super admin opens / on admin', async () => {
    loggedInAs('super_admin');
    open('/');
    expect(await screen.findByRole('heading', { name: 'Client management' })).toBeDefined();
    expect(where()).toBe('/admin');
  });

  it('a reload of /campaign stays on /campaign (the saved session is read before the first render)', async () => {
    loggedInAs('staff');
    open('/campaign');
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(where()).toBe('/campaign');
  });

  it('a client typing /admin is sent to the dashboard', async () => {
    loggedInAs('client');
    open('/admin');
    expect(await screen.findByRole('heading', { name: 'Recent campaigns' })).toBeDefined();
    expect(where()).toBe('/dashboard');
  });

  it('an unknown address goes to the home page', async () => {
    loggedInAs('client');
    open('/no-such-page');
    expect(where()).toBe('/dashboard');
  });

  it('a damaged saved session counts as logged out instead of crashing', async () => {
    localStorage.setItem('reaplift-session', '{not json');
    open('/dashboard');
    expect(where()).toBe('/login');
  });

  it('clicking a menu link changes the address and the page, and marks the link active', async () => {
    loggedInAs('client');
    open('/dashboard');
    const link = screen.getByRole('link', { name: 'Push campaign' });
    await userEvent.click(link);
    expect(where()).toBe('/campaign');
    expect(await screen.findByRole('heading', { name: 'Push campaign' })).toBeDefined();
    expect(link.className).toBe('nav-item active');
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).toBe('nav-item');
  });

  it('shows one menu link per page the role may open', () => {
    loggedInAs('client');
    open('/dashboard');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/campaign', '/login']);
  });
});
