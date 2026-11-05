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
  components: [{ type: 'BODY', text: 'Hi {{1}}, flat 20% off. Use code {{2}}.' }],
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
  rowCount: 1000,
  blankRowsSkipped: 0,
  columns: ['Name', 'Mobile', 'City'],
  numberColumn: 1,
  validCount: 950,
  invalidCount: 40,
  duplicateCount: 10,
  preview: [['Rahul', '9812345678', 'Pune']],
};
const CAMPAIGN = {
  id: 'k1',
  name: 'Diwali wave 1',
  templateId: 't1',
  listId: 'l1',
  variableMap: {},
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
const SUMMARY = {
  total: 1000,
  willSend: 930,
  blocked: { total: 20, byReason: { opted_out: 20 } },
  invalid: { total: 40, byReason: { not_mobile: 25, wrong_country: 15 } },
  duplicate: 10,
  pricePaise: 81,
  gstBp: 1800,
  priceWithGstPaise: 95,
  chargePaise: 90250,
  availablePaise: 200000,
  balancePaise: 200000,
  balanceAfterPaise: 109750,
  limitWarning: null,
  estimate: { messagesAhead: 0, seconds: 21, finishesAt: '2026-11-01T01:00:00Z', waitsForDailyLimit: false },
};

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
const DRAFT = '/clients/c1/campaign?campaign=k1';
const draftRoutes = (extra: Record<string, () => ApiResponse> = {}) => ({
  'GET /api/clients/c1/campaigns': () => ok(empty),
  'GET /api/clients/c1/campaigns/k1': () => ok(CAMPAIGN),
  'GET /api/clients/c1/lists/l1': () => ok(LIST),
  'GET /api/clients/c1/templates/t1': () => ok(TEMPLATE),
  'PUT /api/clients/c1/campaigns/k1': () => ok(CAMPAIGN),
  'GET /api/clients/c1/campaigns/k1/summary': () => ok(SUMMARY),
  ...extra,
});
const fillVariables = async () => {
  await userEvent.selectOptions(await screen.findByLabelText('Fill {{1}} from'), 'Column: Name');
  await userEvent.selectOptions(screen.getByLabelText('Fill {{2}} from'), 'Fixed text');
  await userEvent.type(screen.getByLabelText('Text for {{2}}'), 'DIWALI20');
};

afterEach(cleanup);

describe('starting a campaign', () => {
  it('offers only approved templates, and says so when there are none', async () => {
    open('/clients/c1/campaign?new=1', {
      'GET /api/clients/c1/campaigns': () => ok(empty),
      'GET /api/clients/c1/templates': () => ok({ items: [{ ...TEMPLATE, status: 'PENDING' }], nextCursor: null }),
    });
    await screen.findByText(/A campaign needs an approved template/);
    expect(screen.queryByRole('button', { name: 'Upload and continue' })).toBeNull();
  });

  it('sends the file with its type from the file’s ending, and opens the draft', async () => {
    const calls = open('/clients/c1/campaign?new=1', {
      ...draftRoutes(),
      'GET /api/clients/c1/templates': () => ok({ items: [TEMPLATE, { ...TEMPLATE, id: 't2', name: 'pending_one', status: 'PENDING' }], nextCursor: null }),
      'POST /api/clients/c1/lists': () => ({ status: 201, body: { id: 'l1', rowCount: 1000, blankRowsSkipped: 0, columns: LIST.columns } }),
      'POST /api/clients/c1/campaigns': () => ({ status: 201, body: CAMPAIGN }),
    });
    await userEvent.type(await screen.findByLabelText('Campaign name'), 'Diwali wave 1');
    expect(screen.queryByRole('option', { name: /pending_one/ })).toBeNull();
    // Windows gives a CSV the type of Excel.
    await userEvent.upload(screen.getByLabelText(/^Audience file/), new File(['a,b'], 'customers.csv', { type: 'application/vnd.ms-excel' }));
    await userEvent.click(screen.getByLabelText(/has opted in/));
    await userEvent.click(screen.getByRole('button', { name: 'Upload and continue' }));
    await screen.findByText(/customers.csv: 1,000 rows/);
    const upload = calls.find((c) => c.path.startsWith('/api/clients/c1/lists?'))!;
    expect(upload.path).toContain('optIn=true');
    expect(upload.path).toContain('fileName=customers.csv');
    expect(upload.file?.type).toBe('text/csv');
    expect(sentTo(calls, 'POST', '/api/clients/c1/campaigns')?.body).toEqual({ name: 'Diwali wave 1', templateId: 't1', listId: 'l1' });
  });
});

describe('a draft', () => {
  it('has no next step until the number column is chosen', async () => {
    let list: object = { ...LIST, numberColumn: null, validCount: null, invalidCount: null, duplicateCount: null };
    const calls = open(DRAFT, draftRoutes({
      'GET /api/clients/c1/lists/l1': () => ok(list),
      'PUT /api/clients/c1/lists/l1/number-column': () => {
        list = LIST;
        return ok({ numberColumn: 1, validCount: 950, invalidCount: 40, duplicateCount: 10 });
      },
    }));
    const column = await screen.findByLabelText('Which column has the phone numbers?');
    expect(screen.queryByRole('button', { name: 'See summary' })).toBeNull();
    await userEvent.selectOptions(column, 'Mobile');
    await screen.findByRole('link', { name: /Download these rows/ });
    expect(sentTo(calls, 'PUT', '/api/clients/c1/lists/l1/number-column')?.body).toEqual({ column: 1 });
    expect(screen.getByRole('button', { name: 'See summary' })).toBeTruthy();
  });

  it('needs every variable, previews the first row, and saves the mapping', async () => {
    const calls = open(DRAFT, draftRoutes());
    const button = await screen.findByRole('button', { name: 'See summary' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await fillVariables();
    expect(screen.getByLabelText('Preview').textContent).toBe('Hi Rahul, flat 20% off. Use code DIWALI20.');
    await userEvent.click(button);
    await screen.findByRole('button', { name: 'Confirm and charge ₹902.50' });
    expect(sentTo(calls, 'PUT', '/api/clients/c1/campaigns/k1')?.body).toEqual({
      variableMap: { 1: { column: 0 }, 2: { text: 'DIWALI20' } },
    });
  });

  it('clearing a fixed text after a saved mapping stops the next step', async () => {
    open(DRAFT, draftRoutes({
      'GET /api/clients/c1/campaigns/k1': () => ok({ ...CAMPAIGN, variableMap: { 1: { column: 0 }, 2: { text: 'X' } } }),
    }));
    const button = await screen.findByRole('button', { name: 'See summary' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.clear(screen.getByLabelText('Text for {{2}}'));
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the worked example’s summary with reasons in words', async () => {
    open(DRAFT, draftRoutes());
    await fillVariables();
    await userEvent.click(screen.getByRole('button', { name: 'See summary' }));
    const will = (await screen.findByText('Will send')).nextElementSibling;
    expect(will?.textContent).toBe('930');
    expect(screen.getByText('Opted out').nextElementSibling?.textContent).toBe('20');
    expect(screen.getByText('Wrong country').nextElementSibling?.textContent).toBe('15');
    expect(screen.getByText('Available after this').nextElementSibling?.textContent).toBe('₹1,097.50');
    expect(screen.getByText('Messages charged').nextElementSibling?.textContent).toBe('950');
    expect(screen.getByText(/under a minute/)).toBeTruthy();
  });

  it('short of money: says how much and offers no confirm', async () => {
    open(DRAFT, draftRoutes({
      'GET /api/clients/c1/campaigns/k1/summary': () => ok({ ...SUMMARY, availablePaise: 50000, balanceAfterPaise: -40250 }),
    }));
    await fillVariables();
    await userEvent.click(screen.getByRole('button', { name: 'See summary' }));
    await screen.findByText(/Top up needed: ₹402.50 short/);
    expect((screen.getByRole('button', { name: /Confirm and charge/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('money spent since the summary: the refused confirm says how much is short', async () => {
    const calls = open(DRAFT, draftRoutes({
      'POST /api/clients/c1/campaigns/k1/confirm': () => ({ status: 402, body: { error: 'INSUFFICIENT_BALANCE', message: 'Top up needed', shortPaise: 1000 } }),
    }));
    await fillVariables();
    await userEvent.click(screen.getByRole('button', { name: 'See summary' }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm and charge/ }));
    await screen.findByText('Top up needed: ₹10.00 short. Nothing was charged.');
    expect(calls.filter((c) => c.path.endsWith('/confirm'))).toHaveLength(1);
  });

  it('a reason from the server, such as a paused number, stops at the summary', async () => {
    open(DRAFT, draftRoutes({
      'GET /api/clients/c1/campaigns/k1/summary': () => ({ status: 409, body: { error: 'ACCOUNT_PAUSED', message: 'paused' } }),
    }));
    await fillVariables();
    await userEvent.click(screen.getByRole('button', { name: 'See summary' }));
    await screen.findByText('The WhatsApp number is paused.');
    expect(screen.queryByRole('button', { name: /Confirm and charge/ })).toBeNull();
  });
});

describe('a confirmed campaign', () => {
  const RUNNING = {
    ...CAMPAIGN,
    status: 'running',
    total: 950,
    blocked: 20,
    sent: 100,
    delivered: 50,
    read: 25,
    failed: 12,
    chargedPaise: 90250,
    refundedPaise: 1140,
    estimate: { messagesAhead: 0, seconds: 300, finishesAt: '2026-11-01T01:00:00Z', waitsForDailyLimit: false },
    failures: [{ code: 131049, reason: 'x', count: 5, label: 'Meta limit, not retried' }],
  };

  it('counts add up: delivered and read were also sent; money and reasons are shown', async () => {
    open(DRAFT, draftRoutes({ 'GET /api/clients/c1/campaigns/k1': () => ok(RUNNING) }));
    const tile = async (name: string) => within((await screen.findByText(name)).closest('.money-tile') as HTMLElement).getByRole('strong', { hidden: true });
    expect((await tile('To send')).textContent).toBe('930');
    expect((await tile('Sent')).textContent).toBe('175');
    expect((await tile('Delivered')).textContent).toBe('75');
    expect((await tile('Read')).textContent).toBe('25');
    expect(screen.getByText('Net').nextElementSibling?.textContent).toBe('₹891.10');
    expect(screen.getByText('Meta limit, not retried')).toBeTruthy();
  });

  it('confirming moves from the summary to the live page', async () => {
    let current: object = CAMPAIGN;
    open(DRAFT, draftRoutes({
      'GET /api/clients/c1/campaigns/k1': () => ok(current),
      'POST /api/clients/c1/campaigns/k1/confirm': () => {
        current = RUNNING;
        return ok(SUMMARY);
      },
    }));
    await fillVariables();
    await userEvent.click(screen.getByRole('button', { name: 'See summary' }));
    await userEvent.click(await screen.findByRole('button', { name: /Confirm and charge/ }));
    await screen.findByRole('progressbar');
    expect(screen.getByText('Sending')).toBeTruthy();
  });
});

describe('opt-outs in Admin', () => {
  const routes = {
    'GET /api/admin/clients/c1': () => ok({ id: 'c1', name: 'Northwind Labs', status: 'active', countryCallingCode: '91', contactEmail: 'a@n.com', lowBalanceAlertPaise: null, statusHistory: [], users: [], staff: [] }),
    'GET /api/admin/clients/c1/opt-outs': () => ok({ items: [{ number: '919812345678', source: 'stop_reply', createdAt: '2026-11-01T00:00:00Z' }], nextCursor: null }),
    'POST /api/admin/clients/c1/opt-outs': () => ok({ added: 2, invalid: 1 }),
    'DELETE /api/admin/clients/c1/opt-outs/919812345678': () => ok({ removed: true }),
  };

  it('adds numbers and says how many could not be read', async () => {
    const calls = open('/admin/clients/c1?tab=optouts', routes, 'super_admin');
    await userEvent.type(await screen.findByLabelText(/^Numbers, separated/), '9812345678, 9812345679{enter}abc');
    await userEvent.click(screen.getByRole('button', { name: 'Add opt-outs' }));
    await screen.findByText('2 added. 1 could not be read as numbers.');
    expect(sentTo(calls, 'POST', '/api/admin/clients/c1/opt-outs')?.body).toEqual({ numbers: ['9812345678', '9812345679', 'abc'] });
  });

  it('removing asks first and warns when the customer asked to stop', async () => {
    const calls = open('/admin/clients/c1?tab=optouts', routes, 'super_admin');
    const before = window.confirm;
    let asked = '';
    window.confirm = (text) => {
      asked = String(text);
      return false;
    };
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    window.confirm = before;
    expect(asked).toContain('This customer asked to stop');
    expect(sentTo(calls, 'DELETE', '/api/admin/clients/c1/opt-outs/919812345678')).toBeUndefined();
  });
});
