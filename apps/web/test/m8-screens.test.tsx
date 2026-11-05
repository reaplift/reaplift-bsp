import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api';
import type { ApiRequest, ApiResponse } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';
import { indiaTimeToIso } from '../src/pages/PushCampaign';

const me = (role: string) => ({
  user: { id: 'u1', name: 'Meera', email: 'm@n.com', role },
  workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }],
});
const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const empty = { items: [], nextCursor: null };
const TEMPLATE = {
  id: 't1',
  waAccountId: 'w1',
  metaTemplateId: 'm1',
  name: 'diwali_offer_2026',
  language: 'en_US',
  category: 'MARKETING',
  components: [{ type: 'BODY', text: 'Hi {{1}}, flat 20% off. Use code {{2}} today.' }],
  variableCount: 2,
  status: 'APPROVED',
  validationErrors: null,
  rejectionReason: null,
  metaRecommendation: null,
  rejectionExplanation: null,
  updatedAt: '2026-11-01T00:00:00Z',
};
const LIST = {
  id: 'l1',
  fileName: 'customers.csv',
  rowCount: 10000,
  blankRowsSkipped: 0,
  columns: ['Name', 'Mobile'],
  numberColumn: 1,
  validCount: 10000,
  invalidCount: 0,
  duplicateCount: 0,
  preview: [['Rahul', '9812345678']],
};
const CAMPAIGN = {
  id: 'k1',
  name: 'Diwali wave 2',
  templateId: 't1',
  listId: 'l1',
  variableMap: { '1': { column: 0 }, '2': { text: 'DIWALI20' } },
  status: 'draft',
  total: 0,
  blocked: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  scheduledAt: null,
  confirmedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  estimate: null,
  chargedPaise: 0,
  refundedPaise: 0,
  failures: [],
};
const RUNNING = { ...CAMPAIGN, status: 'running', total: 10000, sent: 3200, chargedPaise: 950000, confirmedAt: '2026-11-01T04:00:00Z' };
const SUMMARY = {
  total: 10000,
  willSend: 10000,
  blocked: { total: 0, byReason: {} },
  invalid: { total: 0, byReason: {} },
  duplicate: 0,
  pricePaise: 81,
  gstBp: 1800,
  priceWithGstPaise: 95,
  chargePaise: 950000,
  availablePaise: 2000000,
  balancePaise: 2000000,
  balanceAfterPaise: 1050000,
  limitWarning: null,
  estimate: { messagesAhead: 0, seconds: 200, finishesAt: '2026-11-01T01:00:00Z', waitsForDailyLimit: false },
};
const WALLET = (holds: object[] = []) => ({ balancePaise: 2000000, onHoldPaise: 950000, availablePaise: 1050000, holds, lowBalanceAlertPaise: null });

function open(path: string, routes: Record<string, () => ApiResponse>, role = 'staff') {
  const calls: ApiRequest[] = [];
  const transport = async (request: ApiRequest): Promise<ApiResponse> => {
    calls.push(request);
    if (request.path === '/api/auth/me') return ok(me(role));
    if (request.path === '/api/me/notifications') return ok({ ...empty, unreadCount: 0 });
    const route = routes[`${request.method} ${request.path.split('?')[0]}`];
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
const sentTo = (calls: ApiRequest[], method: string, path: string) => calls.find((c) => c.method === method && c.path === path);
const PAGE = '/clients/c1/campaign?campaign=k1';

afterEach(cleanup);

describe('pause, resume and cancel', () => {
  it('pause stops a running campaign and Resume takes its place', async () => {
    let current: object = RUNNING;
    const calls = open(PAGE, {
      'GET /api/clients/c1/campaigns/k1': () => ok(current),
      'POST /api/clients/c1/campaigns/k1/pause': () => {
        current = { ...RUNNING, status: 'paused' };
        return ok({ status: 'paused' });
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await screen.findByText(/Paused\. Messages already on their way finish/);
    expect(sentTo(calls, 'POST', '/api/clients/c1/campaigns/k1/pause')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('cancel asks first; saying no sends nothing, yes shows what was refunded', async () => {
    let current: object = RUNNING;
    const calls = open(PAGE, {
      'GET /api/clients/c1/campaigns/k1': () => ok(current),
      'POST /api/clients/c1/campaigns/k1/cancel': () => {
        current = { ...RUNNING, status: 'cancelled' };
        return ok({ status: 'cancelled', cancelled: 6785, refundPaise: 644575 });
      },
    });
    const button = await screen.findByRole('button', { name: 'Cancel campaign' });
    const before = window.confirm;
    window.confirm = () => false;
    await userEvent.click(button);
    expect(sentTo(calls, 'POST', '/api/clients/c1/campaigns/k1/cancel')).toBeUndefined();
    window.confirm = () => true;
    await userEvent.click(button);
    window.confirm = before;
    await screen.findByText('Cancelled. 6,785 messages were not sent, and ₹6,445.75 went back to the wallet.');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel campaign' })).toBeNull());
  });

  it('a refusal from the server is shown in words', async () => {
    open(PAGE, {
      'GET /api/clients/c1/campaigns/k1': () => ok(RUNNING),
      'POST /api/clients/c1/campaigns/k1/pause': () => ({ status: 409, body: { error: 'WRONG_STATUS', message: 'This campaign is completed' } }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await screen.findByText('This campaign cannot do that in its current state.');
  });

  it('a completed campaign has no controls', async () => {
    open(PAGE, { 'GET /api/clients/c1/campaigns/k1': () => ok({ ...RUNNING, status: 'completed' }) });
    await screen.findByText('Completed');
    expect(screen.queryByRole('button', { name: /Pause|Resume|Cancel campaign|Unschedule/ })).toBeNull();
  });
});

describe('schedule', () => {
  const draftRoutes = (extra: Record<string, () => ApiResponse> = {}) => ({
    'GET /api/clients/c1/campaigns': () => ok(empty),
    'GET /api/clients/c1/lists/l1': () => ok(LIST),
    'GET /api/clients/c1/templates/t1': () => ok(TEMPLATE),
    'PUT /api/clients/c1/campaigns/k1': () => ok(CAMPAIGN),
    'GET /api/clients/c1/campaigns/k1/summary': () => ok(SUMMARY),
    ...extra,
  });

  it('typed India time is sent with its offset', () => {
    expect(indiaTimeToIso('2026-11-01T09:00')).toBe('2026-11-01T09:00:00+05:30');
  });

  it('a draft is scheduled from its summary, then shows when it starts and what is on hold; Unschedule makes it a draft', async () => {
    let current: object = CAMPAIGN;
    const calls = open(
      PAGE,
      draftRoutes({
        'GET /api/clients/c1/campaigns/k1': () => ok(current),
        'POST /api/clients/c1/campaigns/k1/schedule': () => {
          current = { ...CAMPAIGN, status: 'scheduled', scheduledAt: '2026-12-01T03:30:00Z' };
          return ok({ status: 'scheduled', scheduledAt: '2026-12-01T03:30:00.000Z', heldPaise: 950000, estimate: SUMMARY.estimate });
        },
        'GET /api/clients/c1/wallet': () =>
          ok(WALLET([{ campaignId: 'k1', campaignName: 'Diwali wave 2', scheduledAt: '2026-12-01T03:30:00Z', amountPaise: 950000 }])),
        'POST /api/clients/c1/campaigns/k1/unschedule': () => {
          current = CAMPAIGN;
          return ok({ status: 'draft' });
        },
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'See summary' }));
    fireEvent.change(await screen.findByLabelText('Start at (India time)'), { target: { value: '2026-12-01T09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(sentTo(calls, 'POST', '/api/clients/c1/campaigns/k1/schedule')?.body).toEqual({ at: '2026-12-01T09:00:00+05:30' });
    await screen.findByText(/Starts at 01 Dec 2026, 09:00 \(India time\)\. ₹9,500\.00 is on hold for it/);
    await userEvent.click(screen.getByRole('button', { name: 'Unschedule' }));
    expect(sentTo(calls, 'POST', '/api/clients/c1/campaigns/k1/unschedule')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'See summary' })).toBeTruthy();
  });

  it('a schedule the wallet cannot cover says how much is short', async () => {
    open(
      PAGE,
      draftRoutes({
        'GET /api/clients/c1/campaigns/k1': () => ok(CAMPAIGN),
        'POST /api/clients/c1/campaigns/k1/schedule': () => ({ status: 402, body: { error: 'INSUFFICIENT_BALANCE', message: 'Top up needed', shortPaise: 50000 } }),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'See summary' }));
    fireEvent.change(await screen.findByLabelText('Start at (India time)'), { target: { value: '2026-12-01T09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    await screen.findByText('Top up needed: ₹500.00 short. Nothing was charged.');
  });
});

describe('the super admin', () => {
  const client = (id: string, name: string) => ({ id, name, status: 'active', countryCallingCode: '91', contactEmail: null, lowBalanceAlertPaise: null });
  const CLIENTS = { items: [client('c1', 'Northwind Labs'), client('c2', 'Greenleaf Foods')], nextCursor: null };

  it('Rules lists what is set and saves a rule for one client', async () => {
    const calls = open(
      '/admin/settings',
      {
        'GET /api/admin/clients': () => ok(CLIENTS),
        'GET /api/admin/rules': () =>
          ok({
            items: [{ id: 'r1', clientId: null, type: 'repeat_within_hours', values: { hours: 24 }, enabled: true, updatedAt: '2026-11-01T00:00:00Z' }],
            nextCursor: null,
          }),
        'PUT /api/admin/rules': () => ok({}),
      },
      'super_admin',
    );
    await screen.findByText('Not the same template to a number within 24 hours');
    await userEvent.selectOptions(screen.getByLabelText('Applies to'), 'Greenleaf Foods');
    await userEvent.selectOptions(screen.getByLabelText('Rule'), 'Marketing messages per number');
    const countField = screen.getByLabelText('At most this many marketing messages');
    await userEvent.clear(countField);
    await userEvent.type(countField, '2');
    await userEvent.selectOptions(screen.getByLabelText('Per'), 'week (7 days)');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await screen.findByText('Saved for Greenleaf Foods. It applies from the next summary or confirm.');
    expect(sentTo(calls, 'PUT', '/api/admin/rules')?.body).toEqual({
      type: 'marketing_cap',
      clientId: 'c2',
      enabled: true,
      values: { count: 2, period: 'week' },
    });
  });

  it('Campaigns lists every client and explains why one is not moving', async () => {
    const LISTED = { ...RUNNING, clientId: 'c1', clientName: 'Northwind Labs', status: 'running' };
    const calls = open(
      '/admin/campaigns',
      {
        'GET /api/admin/clients': () => ok(CLIENTS),
        'GET /api/admin/campaigns': () => ok({ items: [LISTED], nextCursor: null }),
        'GET /api/admin/campaigns/k1/diagnosis': () =>
          ok({
            status: 'running',
            headline: 'The daily limit of 2000 customers is used up. 6785 messages are waiting, and go out as the 24 hours move on.',
            reasons: [
              { code: 'DAILY_LIMIT_REACHED', message: 'The daily limit of 2000 customers is used up. 6785 messages are waiting, and go out as the 24 hours move on.' },
              { code: 'QUEUE_AHEAD', message: '120 earlier messages on this number go first.' },
            ],
            queue: { waiting: 6785, sending: 0, aheadOnNumber: 120 },
            limits: { sendRatePerSec: 50, dailyLimit: 2000, dailySetting: null, metaLimit: 'TIER_2K', remainingToday: 0 },
            estimate: null,
            failures: [{ code: 131026, reason: 'Message undeliverable', count: 3 }],
          }),
      },
      'super_admin',
    );
    await userEvent.click(await screen.findByRole('link', { name: 'Diwali wave 2' }));
    await screen.findByText(/The daily limit of 2000 customers is used up/);
    expect(screen.getByText('120 earlier messages on this number go first.')).toBeTruthy();
    expect(screen.getByText('Message undeliverable')).toBeTruthy();
    expect(screen.getByRole('link', { name: "Open it in the client's workspace" }).getAttribute('href')).toBe('/clients/c1/campaign?campaign=k1');

    // The menu and the breadcrumb both link back to the list.
    await userEvent.click(screen.getAllByRole('link', { name: 'Campaigns' })[0]!);
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Paused');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/campaigns?status=paused')).toBe(true));
  });

  it('a client cannot open the super admin pages', async () => {
    open('/admin/campaigns', { 'GET /api/clients/c1/dashboard': () => ok({}) }, 'client');
    await waitFor(() => expect(screen.queryByText('Every client\'s campaigns, newest first.', { exact: false })).toBeNull());
    expect(screen.queryByRole('link', { name: 'Campaigns' })).toBeNull();
  });
});
