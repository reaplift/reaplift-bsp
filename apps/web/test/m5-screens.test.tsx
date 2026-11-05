import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import type { ApiRequest, ApiResponse } from '../src/api/transport';
import { App } from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ROUTER_FUTURE } from '../src/components/Layout';
import { resetMetaSdkForTests } from '../src/meta/embeddedSignup';

const me = (role: string) => ({
  user: { id: 'u1', name: 'Asha', email: 'a@n.com', role },
  workspaces: [{ clientId: 'c1', name: 'Northwind Labs', status: 'active' }],
});
const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const empty = { items: [], nextCursor: null };
const ACCOUNT = {
  id: 'w1',
  clientId: 'c1',
  wabaId: 'waba-1',
  phoneNumberId: 'phone-1',
  displayPhone: '919800000000',
  displayName: 'Northwind',
  qualityRating: 'GREEN',
  messagingLimit: 'TIER_10K',
  sendRatePerSec: 50,
  dailySendLimit: null,
  metaPayer: 'reaplift_card',
  status: 'active',
  pausedReason: null,
  onboardedVia: 'manual',
  connectedAt: '2026-11-01T00:00:00Z',
};
const TEMPLATE = {
  id: 't1',
  waAccountId: 'w1',
  metaTemplateId: null,
  name: 'order_update',
  language: 'en_US',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Hello {{1}}, your order is ready.', example: { body_text: [['Asha']] } }],
  status: 'DRAFT',
  validationErrors: null,
  rejectionReason: null,
  metaRecommendation: null,
  rejectionExplanation: null,
  updatedAt: '2026-11-01T00:00:00Z',
};
const CLIENT = { id: 'c1', name: 'Northwind Labs', status: 'active', countryCallingCode: '91', contactEmail: 'a@n.com', lowBalanceAlertPaise: null, statusHistory: [], users: [], staff: [] };

function open(path: string, role: string, routes: Record<string, () => ApiResponse>) {
  const calls: ApiRequest[] = [];
  const transport = async (request: ApiRequest): Promise<ApiResponse> => {
    calls.push(request);
    if (request.path === '/api/auth/me') return ok(me(role));
    if (request.path === '/api/me/notifications') return ok({ ...empty, unreadCount: 0 });
    const route = routes[`${request.method} ${request.path}`];
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

describe('the WhatsApp number tab', () => {
  const routes = (account: object) => ({
    'GET /api/admin/clients/c1': () => ok(CLIENT),
    'GET /api/clients/c1/wa-accounts': () => ok({ items: [account], nextCursor: null }),
    'PATCH /api/admin/wa-accounts/w1/limits': () => ok({ sendRatePerSec: 20, dailySendLimit: 500 }),
    'POST /api/admin/wa-accounts/w1/resume': () => ok({ status: 'active' }),
    'POST /api/admin/wa-accounts/w1/share-credit': () => ok({ status: 'active' }),
  });

  it('saves speed and daily limit, and blank means only Meta’s', async () => {
    const calls = open('/admin/clients/c1?tab=number', 'super_admin', routes(ACCOUNT));
    const speed = await screen.findByLabelText(/^Speed/);
    await userEvent.clear(speed);
    await userEvent.type(speed, '20');
    await userEvent.type(screen.getByLabelText(/^Our daily limit/), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await screen.findByText(/Limits saved/);
    expect(sentTo(calls, 'PATCH', '/api/admin/wa-accounts/w1/limits')).toEqual({ sendRatePerSec: 20, dailySendLimit: 500 });
  });

  it('refuses a speed Meta and the server would not take, without calling the server', async () => {
    const calls = open('/admin/clients/c1?tab=number', 'super_admin', routes(ACCOUNT));
    const speed = await screen.findByLabelText(/^Speed/);
    await userEvent.clear(speed);
    await userEvent.type(speed, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    await screen.findByText(/whole number from 1 to 1000/);
    expect(sentTo(calls, 'PATCH', '/api/admin/wa-accounts/w1/limits')).toBeUndefined();
  });

  it('a paused number shows why, and offers Resume', async () => {
    const calls = open('/admin/clients/c1?tab=number', 'super_admin', routes({ ...ACCOUNT, status: 'paused', pausedReason: 'quality low' }));
    await screen.findByText(/Paused: quality low/);
    expect(screen.queryByRole('button', { name: 'Share credit line' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Resume number' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/admin/wa-accounts/w1/resume')).toBe(true));
  });

  it('a number waiting on the credit line offers sharing it, not Resume', async () => {
    open('/admin/clients/c1?tab=number', 'super_admin', routes({ ...ACCOUNT, status: 'paused', pausedReason: 'credit line not shared' }));
    await screen.findByRole('button', { name: 'Share credit line' });
    expect(screen.queryByRole('button', { name: 'Resume number' })).toBeNull();
  });
});

describe('Numbers and limits', () => {
  it('shows each number and the overall figures', async () => {
    open('/admin/numbers', 'super_admin', {
      'GET /api/admin/limits-usage': () =>
        ok({
          items: [
            { waAccountId: 'w1', clientId: 'c1', clientName: 'Northwind Labs', displayPhone: '919800000000', wabaId: 'waba-1', status: 'active', sendRatePerSec: 50, sentPerSecLastMinute: 3, dailySendLimit: null, metaLimit: 'TIER_10K', effectiveDailyLimit: 10000, usedLast24Hours: 2500, remaining: 7500, usedPercent: 25, waiting: 40 },
          ],
          overall: { numbers: 1, pausedNumbers: 0, usedLast24Hours: 2500, waiting: 40, sentPerSecLastMinute: 3, numbersAtDailyLimit: 0 },
        }),
    });
    expect((await screen.findByRole('link', { name: 'Northwind Labs' })).getAttribute('href')).toBe('/admin/clients/c1?tab=number');
    expect(screen.getByLabelText('25% used')).toBeTruthy();
    expect(screen.getByRole('cell', { name: '7,500' })).toBeTruthy();
  });
});

describe('Templates', () => {
  const list = { 'GET /api/clients/c1/wa-accounts': () => ok({ items: [ACCOUNT], nextCursor: null }) };

  it('with no number, says to connect one and offers no new template', async () => {
    open('/clients/c1/templates', 'client', {
      'GET /api/clients/c1/wa-accounts': () => ok(empty),
      'GET /api/clients/c1/templates': () => ok(empty),
    });
    await screen.findByText(/Connect a WhatsApp number first/);
    expect(screen.queryByRole('link', { name: 'New template' })).toBeNull();
  });

  it('a new template sends Meta’s shape, with a sample for each variable', async () => {
    const calls = open('/clients/c1/templates?new=1', 'client', {
      ...list,
      'GET /api/clients/c1/templates': () => ok(empty),
      'POST /api/clients/c1/templates': () => ({ status: 201, body: TEMPLATE }),
      'GET /api/clients/c1/templates/t1': () => ok(TEMPLATE),
    });
    await userEvent.type(await screen.findByLabelText(/^Template name/), 'order_update');
    await userEvent.type(screen.getByLabelText(/^Message/), 'Hello {{{{1}}, your order is ready.');
    await userEvent.type(await screen.findByLabelText(/^Sample for/), 'Asha');
    expect(screen.getByLabelText('Preview').textContent).toContain('Hello Asha, your order is ready.');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('button', { name: 'Submit to Meta' });
    expect(sentTo(calls, 'POST', '/api/clients/c1/templates')).toEqual({
      name: 'order_update',
      language: 'en_US',
      category: 'MARKETING',
      waAccountId: 'w1',
      components: [{ type: 'BODY', text: 'Hello {{1}}, your order is ready.', example: { body_text: [['Asha']] } }],
    });
  });

  it('when our checks stop a template, shows what to fix and how', async () => {
    let current: object = TEMPLATE;
    open('/clients/c1/templates?template=t1', 'client', {
      ...list,
      'GET /api/clients/c1/templates': () => ok(empty),
      'GET /api/clients/c1/templates/t1': () => ok(current),
      'POST /api/clients/c1/templates/t1/submit': () => {
        current = {
          ...TEMPLATE,
          status: 'VALIDATION_FAILED',
          validationErrors: [{ rule: 'category', field: 'BODY', message: 'The body contains promotional words', fix: 'Change the category to Marketing' }],
        };
        return { status: 422, body: current };
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Submit to Meta' }));
    await screen.findByText('The body contains promotional words');
    expect(screen.getByText('Change the category to Marketing')).toBeTruthy();
    expect(screen.getByText('Needs fixing')).toBeTruthy();
  });

  it('a rejected template explains why and can be edited, not resubmitted as it is', async () => {
    open('/clients/c1/templates?template=t1', 'client', {
      ...list,
      'GET /api/clients/c1/templates': () => ok(empty),
      'GET /api/clients/c1/templates/t1': () =>
        ok({ ...TEMPLATE, metaTemplateId: 'm1', status: 'REJECTED', rejectionReason: 'INVALID_FORMAT', rejectionExplanation: 'Meta says the format is wrong.', metaRecommendation: 'Fix the variables.' }),
    });
    await screen.findByText(/Meta says the format is wrong/);
    expect(screen.getByText(/Fix the variables/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit to Meta' })).toBeNull();
  });

  it('an approved template cannot be edited, only copied', async () => {
    const calls = open('/clients/c1/templates?template=t1', 'client', {
      ...list,
      'GET /api/clients/c1/templates': () => ok(empty),
      'GET /api/clients/c1/templates/t1': () => ok({ ...TEMPLATE, metaTemplateId: 'm1', status: 'APPROVED' }),
      'POST /api/clients/c1/templates/t1/copy': () => ({ status: 201, body: { ...TEMPLATE, id: 't2', name: 'order_update_v2' } }),
      'GET /api/clients/c1/templates/t2': () => ok({ ...TEMPLATE, id: 't2', name: 'order_update_v2' }),
    });
    await screen.findByText(/It can be used in campaigns/);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    await userEvent.type(screen.getByLabelText('New name'), 'order_update_v2');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('heading', { name: 'order_update_v2' });
    expect(sentTo(calls, 'POST', '/api/clients/c1/templates/t1/copy')).toEqual({ name: 'order_update_v2' });
  });
});

describe('Settings in a workspace', () => {
  it('a client sees its number and why it is paused, but no way to change limits', async () => {
    open('/clients/c1/settings', 'client', {
      'GET /api/clients/c1/wa-accounts': () => ok({ items: [{ ...ACCOUNT, status: 'paused', pausedReason: 'quality low' }], nextCursor: null }),
    });
    await screen.findByText(/Paused: quality low/);
    expect(screen.queryByRole('button', { name: 'Save limits' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace token' })).toBeNull();
  });

  it('shows who pays Meta for the number', async () => {
    open('/clients/c1/settings', 'client', {
      'GET /api/clients/c1/wa-accounts': () => ok({ items: [{ ...ACCOUNT, metaPayer: 'reaplift_credit_line' }], nextCursor: null }),
    });
    expect(await screen.findByText('ReapLift credit line')).toBeTruthy();
  });
});

describe('Connect WhatsApp', () => {
  const win = window as { FB?: unknown };
  let answer: (code?: string) => void = () => {};
  const fb = {
    init: vi.fn(),
    login: vi.fn((callback: (response: { authResponse?: { code?: string } | null }) => void) => {
      answer = (code) => callback({ authResponse: code ? { code } : null });
    }),
  };
  const signupMessage = (event: string, data: object) =>
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data }) }));

  beforeEach(() => {
    resetMetaSdkForTests();
    win.FB = fb;
    vi.stubEnv('VITE_META_APP_ID', 'app-1');
    vi.stubEnv('VITE_META_CONFIG_ID', 'cfg-1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete win.FB;
  });

  it('stays off with a note when the panel has no Meta app set', async () => {
    vi.stubEnv('VITE_META_APP_ID', '');
    open('/clients/c1/settings', 'client', { 'GET /api/clients/c1/wa-accounts': () => ok(empty) });
    const button = (await screen.findByRole('button', { name: 'Connect WhatsApp' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Please contact ReapLift to connect your number/)).toBeTruthy();
  });

  it('sends the code and IDs from Meta to the server and shows the connected number', async () => {
    let connected = false;
    const calls = open('/clients/c1/settings', 'client', {
      'GET /api/clients/c1/wa-accounts': () => ok(connected ? { items: [{ ...ACCOUNT, metaPayer: 'reaplift_credit_line' }], nextCursor: null } : empty),
      'POST /api/clients/c1/wa-accounts/embedded-signup': () => {
        connected = true;
        return { status: 201, body: { ...ACCOUNT, metaPayer: 'reaplift_credit_line', onboardedVia: 'embedded_signup' } };
      },
    });
    const button = (await screen.findByRole('button', { name: 'Connect WhatsApp' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.click(button);
    signupMessage('FINISH', { waba_id: 'waba-9', phone_number_id: 'phone-9' });
    answer('code-1');
    await screen.findByText('919800000000 is connected.');
    expect(sentTo(calls, 'POST', '/api/clients/c1/wa-accounts/embedded-signup')).toEqual({ code: 'code-1', wabaId: 'waba-9', phoneNumberId: 'phone-9' });
    expect(await screen.findByText('ReapLift credit line')).toBeTruthy();
  });

  it('a cancel in the pop-up sends nothing and says so', async () => {
    const calls = open('/clients/c1/settings', 'staff', { 'GET /api/clients/c1/wa-accounts': () => ok(empty) });
    const button = (await screen.findByRole('button', { name: 'Connect WhatsApp' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.click(button);
    signupMessage('CANCEL', { current_step: 'PHONE_NUMBER_SETUP' });
    await screen.findByText(/Connecting was cancelled/);
    expect(sentTo(calls, 'POST', '/api/clients/c1/wa-accounts/embedded-signup')).toBeUndefined();
  });

  it("explains Meta refusing the connection in the client's words", async () => {
    open('/clients/c1/settings', 'client', {
      'GET /api/clients/c1/wa-accounts': () => ok(empty),
      'POST /api/clients/c1/wa-accounts/embedded-signup': () => ({ status: 400, body: { error: 'META_REFUSED', message: 'Meta refused the signup code (code 100)' } }),
    });
    const button = (await screen.findByRole('button', { name: 'Connect WhatsApp' })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await userEvent.click(button);
    signupMessage('FINISH', { waba_id: 'waba-9', phone_number_id: 'phone-9' });
    answer('code-1');
    await screen.findByText('Meta did not accept the connection. Please try again, or contact ReapLift.');
  });
});

describe('asking before a change that cannot be undone quietly', () => {
  const USER = { id: 'u2', name: 'Bala', email: 'b@n.com', role: 'client', status: 'active' };
  const routes = {
    'GET /api/admin/clients/c1': () => ok({ ...CLIENT, users: [USER] }),
    'PATCH /api/admin/users/u2': () => ok({ status: 'disabled' }),
    'GET /api/clients/c1/wa-accounts': () => ok(empty),
  };

  it('saying no to Disable changes nothing; yes does it', async () => {
    const calls = open('/admin/clients/c1?tab=logins', 'super_admin', routes);
    const button = await screen.findByRole('button', { name: 'Disable' });
    const before = window.confirm;
    window.confirm = () => false;
    await userEvent.click(button);
    expect(sentTo(calls, 'PATCH', '/api/admin/users/u2')).toBeUndefined();
    window.confirm = before;
    await userEvent.click(button);
    await waitFor(() => expect(sentTo(calls, 'PATCH', '/api/admin/users/u2')).toEqual({ status: 'disabled' }));
  });

  it('Generate password fills a strong one and shows it', async () => {
    open('/admin/clients/c1?tab=logins', 'super_admin', routes);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate password' }));
    const field = screen.getByLabelText(/First password/) as HTMLInputElement;
    expect(field.value).toMatch(/^[a-zA-Z2-9]{14}$/);
    expect(field.type).toBe('text');
  });
});
