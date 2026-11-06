import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MONTHLY_REPORT_COLUMNS } from '@reaplift/shared';
import { createApi } from '../src/api';
import type { ApiRequest, ApiResponse } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';
import { shortDay } from '../src/pages/Dashboard';
import { parsePerAccount } from '../src/pages/admin/MetaCostPage';

const me = (role: string) => ({
  user: { id: 'u1', name: 'Asha', email: 'asha@northwind.com', role },
  workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }],
});
const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const empty = { items: [], nextCursor: null };

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function open(path: string, routes: Record<string, (request: ApiRequest) => ApiResponse>, role = 'client') {
  const calls: ApiRequest[] = [];
  const transport = async (request: ApiRequest): Promise<ApiResponse> => {
    calls.push(request);
    if (request.path === '/api/auth/me') return ok(me(role));
    if (request.path === '/api/me/notifications') return ok({ ...empty, unreadCount: 0 });
    const route = routes[`${request.method} ${request.path.split('?')[0]}`];
    return route ? route(request) : { status: 404, body: { error: 'NOT_FOUND', message: `no route ${request.method} ${request.path}` } };
  };
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider api={createApi(() => transport)}>
        <App />
        <Where />
      </AuthProvider>
    </MemoryRouter>,
  );
  return calls;
}
const sent = (calls: ApiRequest[], method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

afterEach(cleanup);

// The worked example's 1 November: October was "last month".
const days = Array.from({ length: 15 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 18 + i));
  return { date: day.toISOString().slice(0, 10), messages: 0, delivered: 0, read: 0, failed: 0 };
});
days[13] = { date: '2026-10-31', messages: 3000, delivered: 2700, read: 1800, failed: 40 };
days[12] = { date: '2026-10-30', messages: 1000, delivered: 902, read: 610, failed: 12 };
const DASHBOARD = {
  tiles: {
    yesterday: { messages: 3000, spendPaise: 285000 },
    last15Days: { messages: 4000, spendPaise: 380000 },
    thisMonth: { messages: 0, spendPaise: 0 },
    lastMonth: { messages: 11214, spendPaise: 1065330 },
  },
  chart: days,
  accounts: [
    { displayPhone: '919812345678', displayName: 'Northwind', qualityRating: 'GREEN', messagingLimit: 'TIER_10K', status: 'active', pausedReason: null },
  ],
};

describe('dashboard', () => {
  it('shows the four tiles, the day chart and the account box, and nothing about Meta cost', async () => {
    const calls = open('/clients/c1/dashboard', { 'GET /api/clients/c1/dashboard': () => ok(DASHBOARD) });
    const tile = async (label: string) => (await screen.findByText(label)).closest('.stat-card') as HTMLElement;
    expect(within(await tile('Yesterday')).getByText('3,000')).toBeTruthy();
    expect(within(await tile('Yesterday')).getByText('₹2,850.00 spent')).toBeTruthy();
    expect(within(await tile('Last 15 days')).getByText('4,000')).toBeTruthy();
    expect(within(await tile('This month')).getByText('₹0.00 spent')).toBeTruthy();
    expect(within(await tile('Last month')).getByText('11,214')).toBeTruthy();
    expect(within(await tile('Last month')).getByText('₹10,653.30 spent')).toBeTruthy();

    const rows = within(screen.getByRole('table', { name: 'Messages per day, last 15 days' })).getAllByRole('row');
    expect(rows).toHaveLength(16);
    expect(rows[14]!.textContent).toBe('31 Oct3,0002,7001,80040');

    expect(screen.getByText('919812345678')).toBeTruthy();
    expect(screen.getByText('GREEN')).toBeTruthy();
    expect(screen.getByText('TIER_10K')).toBeTruthy();
    expect(screen.queryByText(/Meta cost|margin/i)).toBeNull();
    expect(sent(calls, 'GET', '/api/clients/c1/dashboard')).toHaveLength(1);
  });

  it('says so when there was no activity and no number is connected', async () => {
    open('/clients/c1/dashboard', {
      'GET /api/clients/c1/dashboard': () => ok({ ...DASHBOARD, chart: days.map((d) => ({ ...d, messages: 0 })), accounts: [] }),
    });
    await screen.findByText('No campaign activity in the last 15 days.');
    expect(screen.getByText('No WhatsApp number connected yet.')).toBeTruthy();
  });

  it('a day is shown as the day the server counted, whatever the browser time zone', () => {
    expect(shortDay('2026-10-31')).toBe('31 Oct');
    expect(shortDay('2026-11-01')).toBe('01 Nov');
  });
});

const ROW = Object.fromEntries(
  MONTHLY_REPORT_COLUMNS.map((c, i) => [
    c,
    [1, 'October', 2026, 'Northwind Labs', 'Diwali 2026 wave 1', 1000, 0, 12, 20, 968, 902, 4, 0, 610, '1059.94'][i]!,
  ]),
);
const CAMPAIGNS = {
  items: [
    { id: 'k1', name: 'Diwali 2026 wave 1', templateId: 't1', listId: 'l1', variableMap: {}, status: 'completed', total: 1000, blocked: 20, sent: 968, delivered: 902, read: 610, failed: 12, scheduledAt: null, confirmedAt: '2026-10-20T04:00:00Z', createdAt: '2026-10-20T03:00:00Z' },
    { id: 'k2', name: 'Still a draft', templateId: 't1', listId: 'l1', variableMap: {}, status: 'draft', total: null, blocked: null, sent: null, delivered: null, read: null, failed: null, scheduledAt: null, confirmedAt: null, createdAt: '2026-10-21T03:00:00Z' },
    { id: 'k3', name: 'Diwali 2026 wave 2', templateId: 't1', listId: 'l1', variableMap: {}, status: 'completed', total: 500, blocked: 0, sent: 500, delivered: 500, read: 0, failed: 0, scheduledAt: null, confirmedAt: '2026-10-25T04:00:00Z', createdAt: '2026-10-25T03:00:00Z' },
  ],
  nextCursor: null,
};

describe('reports', () => {
  const routes = {
    'GET /api/clients/c1/reports/monthly': (r: ApiRequest) =>
      ok({ columns: [...MONTHLY_REPORT_COLUMNS], items: r.path.endsWith('month=2026-10') ? [ROW] : [] }),
    'GET /api/clients/c1/campaigns': () => ok(CAMPAIGNS),
  };

  it("shows the month's campaigns under Dovesoft's headings, and the downloads follow the month", async () => {
    const calls = open('/clients/c1/reports', routes);
    await screen.findByText('No campaigns were confirmed in this month.');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } });
    await screen.findByText('Diwali 2026 wave 1', { selector: 'td' });
    expect(sent(calls, 'GET', '/api/clients/c1/reports/monthly?month=2026-10')).toHaveLength(1);

    const table = screen.getAllByRole('table')[0]!;
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([...MONTHLY_REPORT_COLUMNS]);
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['1', 'October', '2026', 'Northwind Labs', 'Diwali 2026 wave 1', '1,000', '0', '12', '20', '968', '902', '4', '0', '610', '₹1,059.94']);

    const csv = screen.getAllByRole('link', { name: 'Download CSV' })[0]!;
    expect(csv.getAttribute('href')).toBe('/api/clients/c1/reports/monthly?month=2026-10&format=csv');
    expect(screen.getAllByRole('link', { name: 'Download Excel' })[0]!.getAttribute('href')).toBe(
      '/api/clients/c1/reports/monthly?month=2026-10&format=xlsx',
    );
  });

  it('the per-number report offers only sent campaigns, and downloads the one chosen', async () => {
    open('/clients/c1/reports', routes);
    const select = await screen.findByLabelText('Campaign');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Diwali 2026 wave 1 (20 Oct 2026, 09:30)', 'Diwali 2026 wave 2 (25 Oct 2026, 09:30)']);
    const links = () => screen.getAllByRole('link', { name: /Download (CSV|Excel)/ }).slice(2).map((l) => l.getAttribute('href'));
    expect(links()).toEqual(['/api/clients/c1/campaigns/k1/report?format=csv', '/api/clients/c1/campaigns/k1/report?format=xlsx']);
    await userEvent.selectOptions(select, 'k3');
    expect(links()).toEqual(['/api/clients/c1/campaigns/k3/report?format=csv', '/api/clients/c1/campaigns/k3/report?format=xlsx']);
  });

  it('with nothing sent, says so instead of offering a download', async () => {
    open('/clients/c1/reports', { ...routes, 'GET /api/clients/c1/campaigns': () => ok({ items: [CAMPAIGNS.items[1]], nextCursor: null }) });
    await screen.findByText('No campaigns have been sent yet.');
    expect(screen.queryByLabelText('Campaign')).toBeNull();
  });
});

const META_VIEW = {
  month: '2026-10',
  clients: [
    {
      clientId: 'c1',
      name: 'Northwind Labs',
      billedPaise: 902830,
      gstPaise: 162500,
      metaCostPaise: 778500,
      marginPaise: 124330,
      accounts: [{ displayPhone: '919812345678', qualityRating: 'GREEN', messagingLimit: 'TIER_10K', status: 'active' }],
    },
    { clientId: 'c2', name: 'Bluebird Retail', billedPaise: 100000, gstPaise: 18000, metaCostPaise: 80000, marginPaise: 20000, accounts: [] },
  ],
  errors: [{ clientId: 'c1', code: 131026, reason: 'Message undeliverable', count: 12 }],
  creditLine: { limitPaise: 1000000, usedPaise: 858500, usedPercent: 85 },
};

describe('Meta cost and margin (super admin)', () => {
  const routes = (extra: Record<string, (r: ApiRequest) => ApiResponse> = {}) => ({
    'GET /api/admin/meta-view': () => ok(META_VIEW),
    'GET /api/admin/meta-invoices': () => ok(empty),
    ...extra,
  });

  it('a client or staff member opening it is sent home, and never asks for it', async () => {
    for (const role of ['client', 'staff']) {
      const calls = open('/admin/meta-cost', routes(), role);
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/clients/c1/dashboard'));
      expect(calls.some((c) => c.path.startsWith('/api/admin/'))).toBe(false);
      expect(screen.queryByRole('link', { name: 'Meta cost and margin' })).toBeNull();
      cleanup();
    }
  });

  it('shows billed, Meta cost and margin per client with totals, errors by code, and the credit line', async () => {
    open('/admin/meta-cost', routes(), 'super_admin');
    const row = (await screen.findAllByText('Northwind Labs', { selector: 'td' }))[0]!.closest('tr')!;
    expect([...row.querySelectorAll('td')].map((c) => c.textContent)).toEqual([
      'Northwind Labs',
      '₹9,028.30',
      '₹1,625.00',
      '₹7,785.00',
      '₹1,243.30',
      '919812345678 (GREEN, TIER_10K)',
    ]);
    const totals = screen.getByText('All clients').closest('tr')!;
    expect(totals.textContent).toBe('All clients₹10,028.30₹8,585.00₹1,443.30');
    expect(screen.getByText('131026').closest('tr')!.textContent).toBe('Northwind Labs131026Message undeliverable12');
    expect(screen.getByText(/This month:/).textContent).toBe('This month: ₹8,585.00 of ₹10,000.00 used (85%).');
  });

  it('the credit limit is typed in rupees and sent in paise', async () => {
    const calls = open('/admin/meta-cost', routes({ 'PUT /api/admin/credit-limit': () => ok({ limitPaise: 50000000 }) }), 'super_admin');
    await userEvent.type(await screen.findByLabelText('Credit limit (₹)'), '500000');
    await userEvent.click(screen.getByRole('button', { name: 'Save limit' }));
    await screen.findByText('Credit limit set to ₹5,00,000.00.');
    expect(sent(calls, 'PUT', '/api/admin/credit-limit')[0]!.body).toEqual({ limitPaise: 50000000 });
  });

  it("Meta's invoice is checked; a mismatch is shown with the accounts that differ most", async () => {
    const calls = open(
      '/admin/meta-cost',
      routes({
        'POST /api/admin/meta-invoices': () => ({
          status: 201,
          body: {
            id: 'i1',
            month: '2026-10',
            invoicePaise: 900000,
            recordedPaise: 858500,
            differencePaise: 41500,
            differencePercent: 4.61,
            mismatch: true,
            largestDifferences: [{ wabaId: '1022', invoicePaise: 820000, recordedPaise: 778500, differencePaise: 41500 }],
          },
        }),
      }),
      'super_admin',
    );
    fireEvent.change(await screen.findByLabelText('Month', { selector: 'input[name="month"]' }), { target: { value: '2026-10' } });
    await userEvent.type(screen.getByLabelText('Invoice total (₹)'), '9000');
    await userEvent.type(screen.getByLabelText(/Per account/), '1022, 8200');
    await userEvent.click(screen.getByRole('button', { name: 'Check invoice' }));
    const status = (await screen.findByText(/^Mismatch:/)).closest('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain('Mismatch: invoice ₹9,000.00, recorded ₹8,585.00, difference ₹415.00 (4.61%).');
    expect(status.textContent).toContain('Super admins have been notified.');
    expect(within(status).getByText('1022').closest('tr')!.textContent).toBe('1022₹8,200.00₹7,785.00₹415.00');
    expect(sent(calls, 'POST', '/api/admin/meta-invoices')[0]!.body).toEqual({ month: '2026-10', totalPaise: 900000, perAccount: { '1022': 820000 } });
  });

  it('a bad per-account line is refused before anything is sent', async () => {
    const calls = open('/admin/meta-cost', routes(), 'super_admin');
    await userEvent.type(await screen.findByLabelText('Invoice total (₹)'), '9000');
    await userEvent.type(screen.getByLabelText(/Per account/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Check invoice' }));
    await screen.findByText('Write each account on its own line as: account ID, amount in rupees.');
    expect(sent(calls, 'POST', '/api/admin/meta-invoices')).toHaveLength(0);
  });

  it('per-account lines are read as account ID and rupees', () => {
    expect(parsePerAccount('')).toBeUndefined();
    expect(parsePerAccount('1022, 8200\n 3044,10.5 \n')).toEqual({ '1022': 820000, '3044': 1050 });
    expect(parsePerAccount('1022')).toBeNull();
    expect(parsePerAccount('1022, 1.005')).toBeNull();
    expect(parsePerAccount('waba-1, 10')).toEqual({ 'waba-1': 1000 });
    expect(parsePerAccount('10 22, 10')).toBeNull();
  });
});
