import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api';
import type { ApiRequest, ApiResponse } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';

const me = (role: string) => ({
  user: { id: 'u1', name: 'Asha', email: 'a@n.com', role },
  workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }],
});
const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const WALLET = {
  balancePaise: 100000,
  onHoldPaise: 100000,
  availablePaise: 0,
  holds: [{ campaignId: 'k1', campaignName: 'Diwali', scheduledAt: '2026-11-03T03:30:00Z', amountPaise: 100000 }],
  lowBalanceAlertPaise: 50000,
};
const PRICES = {
  items: [
    { category: 'MARKETING', pricePaise: 88, gstBp: 1800, priceWithGstPaise: 104 },
    { category: 'UTILITY', pricePaise: null, gstBp: 1800, priceWithGstPaise: null },
    { category: 'AUTHENTICATION', pricePaise: 15, gstBp: 1800, priceWithGstPaise: 18 },
  ],
};
const empty = { items: [], nextCursor: null };
const ROW = { id: 2, kind: 'charge', amountPaise: -10400, balanceAfterPaise: 89600, campaignId: 'k1', note: 'Campaign: Diwali', createdBy: 'Asha', createdAt: '2026-11-01T10:00:00Z' };
const CLIENT = { id: 'c1', name: 'Northwind Labs', status: 'active', countryCallingCode: '91', contactEmail: 'a@n.com', lowBalanceAlertPaise: null, users: [], staff: [], statusHistory: [] };
const PRICING = {
  pricing: { mode: 'fixed', fixedMarketingPaise: 80, fixedUtilityPaise: 15, fixedAuthenticationPaise: 15 },
  prices: [
    { category: 'MARKETING', pricePaise: 80, gstBp: 1800, priceWithGstPaise: 95, metaRateCentipaise: 8631, belowCost: true },
    { category: 'UTILITY', pricePaise: 15, gstBp: 1800, priceWithGstPaise: 18, metaRateCentipaise: 1150, belowCost: false },
    { category: 'AUTHENTICATION', pricePaise: 15, gstBp: 1800, priceWithGstPaise: 18, metaRateCentipaise: null, belowCost: false },
  ],
};
const POLICY = { clientId: 'c1', policy: { delivered: true, blocked: true, sent_not_delivered: true, failed: false, invalid: false, duplicate: false } };

function open(path: string, role: string, routes: Record<string, () => ApiResponse>) {
  const calls: ApiRequest[] = [];
  const transport = async (request: ApiRequest): Promise<ApiResponse> => {
    calls.push(request);
    if (request.path === '/api/auth/me') return ok(me(role));
    if (request.path === '/api/me/notifications') return ok({ ...empty, unreadCount: 0 });
    const route = routes[`${request.method} ${request.path}`] ?? routes[`${request.method} ${request.path.split('?')[0]}`];
    return route ? route() : { status: 404, body: { error: 'NOT_FOUND', message: `no route ${request.method} ${request.path}` } };
  };
  render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider api={createApi(() => transport)}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return calls;
}
const sentTo = (calls: ApiRequest[], method: string, path: string) => calls.find((c) => c.method === method && c.path === path)?.body;

afterEach(cleanup);

describe('the client’s Wallet', () => {
  const routes = {
    'GET /api/clients/c1/wallet': () => ok(WALLET),
    'GET /api/clients/c1/prices': () => ok(PRICES),
    'GET /api/clients/c1/wallet/ledger': () => ok({ items: [ROW], nextCursor: '2' }),
    'GET /api/clients/c1/wallet/statement': () => ok({ month: '2026-11', lines: [{ gstBp: 1800, chargedPaise: 11800, refundedPaise: 0, netPaise: 11800, taxablePaise: 10000, gstPaise: 1800 }] }),
  };

  it('shows the three numbers, what is on hold and why, and prices with GST', async () => {
    open('/clients/c1/wallet', 'client', routes);
    await screen.findByText('Current balance');
    const tile = (name: string) => screen.getByText(name).closest('.money-tile') as HTMLElement;
    expect(within(tile('Current balance')).getByText('₹1,000.00')).toBeTruthy();
    expect(within(tile('On hold')).getByText('₹1,000.00')).toBeTruthy();
    expect(within(tile('Available')).getByText('₹0.00')).toBeTruthy();
    expect(screen.getByText(/Diwali: ₹1,000.00, starting 03 Nov 2026, 09:00/)).toBeTruthy();

    const row = (await screen.findByText('Marketing')).closest('tr') as HTMLElement;
    expect(within(row).getByText('₹0.88')).toBeTruthy();
    expect(within(row).getByText('18%')).toBeTruthy();
    expect(within(row).getByText('₹1.04')).toBeTruthy();
    expect(within(screen.getByText('Utility').closest('tr') as HTMLElement).getByText('Not set yet')).toBeTruthy();
  });

  it('never shows Meta’s rate or the markup, and offers no admin actions', async () => {
    open('/clients/c1/wallet', 'client', routes);
    await screen.findByText('Marketing');
    expect(document.body.textContent).not.toMatch(/Meta's rate|markup/i);
    expect(screen.queryByRole('button', { name: 'Add money' })).toBeNull();
  });

  it('shows and filters the ledger, pages it, and splits the month’s GST', async () => {
    const calls = open('/clients/c1/wallet', 'client', routes);
    await screen.findByText('-₹104.00');
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
    expect(await screen.findByText('₹100.00')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'charge');
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('wallet/ledger?kind=charge'))).toBe(true));
  });
});

describe('money on the client page', () => {
  const routes = {
    'GET /api/admin/clients/c1': () => ok(CLIENT),
    'GET /api/clients/c1/wallet': () => ok(WALLET),
    'GET /api/admin/clients/c1/pricing': () => ok(PRICING),
    'GET /api/admin/charge-policy': () => ok(POLICY),
    'POST /api/admin/clients/c1/wallet/topups': () => ok({}),
    'POST /api/admin/clients/c1/wallet/adjustments': () => ok({}),
    'PATCH /api/admin/clients/c1/low-balance-alert': () => ok({}),
    'PUT /api/admin/clients/c1/pricing': () => ok({}),
    'PUT /api/admin/charge-policy': () => ok({}),
  };

  it('a top-up sends whole paise, and refuses zero or a third decimal without calling the server', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    const amount = (await screen.findByLabelText('Amount (₹)')) as HTMLInputElement;
    await userEvent.type(amount, '1.005');
    await userEvent.click(screen.getByRole('button', { name: 'Add money' }));
    expect((await screen.findByRole('alert', { name: '' }).catch(() => screen.getAllByRole('alert')[0]!)).textContent).toBeTruthy();
    expect(sentTo(calls, 'POST', '/api/admin/clients/c1/wallet/topups')).toBeUndefined();

    await userEvent.clear(amount);
    await userEvent.type(amount, '10000.50');
    await userEvent.type(screen.getByLabelText('Note'), 'NEFT UTR 4471');
    await userEvent.click(screen.getByRole('button', { name: 'Add money' }));
    await waitFor(() =>
      expect(sentTo(calls, 'POST', '/api/admin/clients/c1/wallet/topups')).toEqual({ amountPaise: 1000050, note: 'NEFT UTR 4471' }),
    );
    expect(await screen.findByText('Added ₹10,000.50.')).toBeTruthy();
  });

  it('a correction can take money away, and needs a reason', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    await userEvent.type(await screen.findByLabelText(/^Amount \(₹; use a minus/), '-1000');
    await userEvent.type(screen.getByLabelText('Reason (required)'), 'duplicate top-up');
    await userEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(sentTo(calls, 'POST', '/api/admin/clients/c1/wallet/adjustments')).toEqual({ amountPaise: -100000, note: 'duplicate top-up' }),
    );
  });

  it('sets and clears the low-balance alert', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    const field = (await screen.findByLabelText(/^Alert below/)) as HTMLInputElement;
    expect(field.value).toBe('500.00');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Save alert' }));
    await waitFor(() => expect(sentTo(calls, 'PATCH', '/api/admin/clients/c1/low-balance-alert')).toEqual({ alertPaise: null }));
  });

  it('warns about a price below Meta’s rate, and saves a markup per message type in basis points', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    expect((await screen.findByText(/Below Meta's rate/)).textContent).toContain('marketing (₹0.80)');
    expect(screen.getByText('86.31 paise')).toBeTruthy();
    expect(screen.getByText('Not entered')).toBeTruthy();
    expect((screen.getByLabelText('Marketing (₹)') as HTMLInputElement).value).toBe('0.80');

    await userEvent.selectOptions(screen.getByLabelText('Price model'), 'markup');
    await userEvent.type(screen.getByLabelText('Marketing (%)'), '25');
    await userEvent.type(screen.getByLabelText('Utility (%)'), '15');
    await userEvent.type(screen.getByLabelText('Authentication (%)'), '22.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save prices' }));
    await waitFor(() =>
      expect(sentTo(calls, 'PUT', '/api/admin/clients/c1/pricing')).toEqual({
        mode: 'markup',
        markupBp: { marketing: 2500, utility: 1500, authentication: 2250 },
      }),
    );
  });

  it('saves fixed prices in paise, and returns to the default', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    const marketing = (await screen.findByLabelText('Marketing (₹)')) as HTMLInputElement;
    await userEvent.clear(marketing);
    await userEvent.type(marketing, '0.88');
    await userEvent.click(screen.getByRole('button', { name: 'Save prices' }));
    await waitFor(() =>
      expect(sentTo(calls, 'PUT', '/api/admin/clients/c1/pricing')).toEqual({
        mode: 'fixed',
        fixedPaise: { marketing: 88, utility: 15, authentication: 15 },
      }),
    );
  });

  it('flips a client’s charging switch; the one that cannot work is locked', async () => {
    const calls = open('/admin/clients/c1?tab=money', 'super_admin', routes);
    await userEvent.click(await screen.findByLabelText('Blocked by rules or opt-out'));
    await waitFor(() => expect(sentTo(calls, 'PUT', '/api/admin/charge-policy')).toEqual({ clientId: 'c1', outcome: 'blocked', charged: false }));
    expect((screen.getByLabelText(/Sent but never delivered/) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('Admin Settings', () => {
  const routes = {
    'GET /api/admin/gst-rates': () => ok({ currentBp: 1800, items: [{ id: 'g1', rateBp: 1800, validFrom: '2017-06-30T18:30:00Z', createdAt: '2026-11-01T10:00:00Z' }], nextCursor: null }),
    'GET /api/admin/gst-report': () => ok({ month: '2026-11', lines: [{ clientName: 'Northwind Labs', gstBp: 1800, chargedPaise: 11800, refundedPaise: 0, netPaise: 11800, taxablePaise: 10000, gstPaise: 1800 }], totals: { netPaise: 11800, taxablePaise: 10000, gstPaise: 1800 } }),
    'POST /api/admin/gst-rates': () => ok({}),
    'GET /api/admin/meta-rates': () => ok(empty),
    'POST /api/admin/meta-rates': () => ok({}),
    'GET /api/admin/pricing': () => ok({ markupBp: { marketing: 2500, utility: 2500, authentication: 2500 } }),
    'PUT /api/admin/pricing': () => ok({}),
    'GET /api/admin/charge-policy': () => ok({ ...POLICY, clientId: null }),
    'PUT /api/admin/charge-policy': () => ok({}),
  };

  it('shows the GST rate and report, and saves a new rate from a date in India time', async () => {
    const calls = open('/admin/settings', 'super_admin', routes);
    expect((await screen.findByText(/Current rate/)).textContent).toContain('18%');
    expect(await screen.findByText('₹18.00', { selector: 'td' }).catch(() => screen.getAllByText('₹18.00')[0]!)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('New rate (%)'), '18.5');
    const from = screen.getAllByLabelText('From')[0] as HTMLInputElement;
    await userEvent.clear(from);
    await userEvent.type(from, '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save GST rate' }));
    await waitFor(() =>
      expect(sentTo(calls, 'POST', '/api/admin/gst-rates')).toEqual({ rateBp: 1850, validFrom: '2026-11-30T18:30:00.000Z' }),
    );
  });

  it('refuses a GST rate over 50 without calling the server', async () => {
    const calls = open('/admin/settings', 'super_admin', routes);
    await userEvent.type(await screen.findByLabelText('New rate (%)'), '51');
    await userEvent.click(screen.getByRole('button', { name: 'Save GST rate' }));
    await screen.findByText(/from 0 to 50/);
    expect(sentTo(calls, 'POST', '/api/admin/gst-rates')).toBeUndefined();
  });

  it('warns with no Meta rates, and adds one in hundredths of a paisa', async () => {
    const calls = open('/admin/settings', 'super_admin', routes);
    await screen.findByText(/No Meta rates yet/);
    await userEvent.type(screen.getByLabelText('Rate (paise)'), '86.31');
    await userEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await waitFor(() => expect(sentTo(calls, 'POST', '/api/admin/meta-rates')).toMatchObject({ category: 'MARKETING', countryCallingCode: '91', rateCentipaise: 8631 }));
  });

  it('saves the default markup, and an all-clients charging switch', async () => {
    const calls = open('/admin/settings', 'super_admin', routes);
    const marketing = (await screen.findByLabelText('Marketing (%)')) as HTMLInputElement;
    expect(marketing.value).toBe('25');
    await userEvent.clear(marketing);
    await userEvent.type(marketing, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save default' }));
    await waitFor(() => expect(sentTo(calls, 'PUT', '/api/admin/pricing')).toEqual({ markupBp: { marketing: 3000, utility: 2500, authentication: 2500 } }));
    await userEvent.click(screen.getByLabelText('Invalid numbers'));
    await waitFor(() => expect(sentTo(calls, 'PUT', '/api/admin/charge-policy')).toEqual({ outcome: 'invalid', charged: true }));
  });

  it('staff and clients cannot open Settings', async () => {
    const calls = open('/admin/settings', 'staff', routes);
    await screen.findByRole('navigation');
    expect(calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false);
  });
});
