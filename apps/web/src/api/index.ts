import {
  AdminClient,
  AdminClientDetail,
  AdminClientList,
  AdminUserList,
  AuditPage,
  ChargePolicyView,
  ClientPricingView,
  DefaultPricingView,
  DeliveryLog,
  GstRateList,
  GstReport,
  AudienceList,
  AudienceUploaded,
  AdminCampaignList,
  CampaignCancelled,
  CampaignDetail,
  CampaignDiagnosis,
  CampaignList,
  CampaignScheduled,
  RuleList,
  type RuleInput,
  CampaignSummary,
  CampaignView,
  DashboardView,
  MetaInvoiceCheck,
  MetaInvoiceList,
  MetaView,
  MonthlyReport,
  LedgerPage,
  OptOutList,
  OptOutsAdded,
  type VariableMap,
  LimitUsage,
  LoginResponse,
  MetaRateList,
  MeResponse,
  MyNotifications,
  PriceList,
  StatementView,
  TemplateList,
  TemplateView,
  WaAccount,
  WaAccountList,
  WordSetting,
  type TemplateComponent,
  WalletView,
  type LoginRequest,
} from '@reaplift/shared';
import { call, type ResponseSchema } from './client';
import { fetchTransport, type ApiRequest, type Transport } from './transport';

export { ApiError } from './client';

export type ApiMode = 'real' | 'mock';

/** `mock` only in development and only when asked for; a production build is always `real`. */
export function apiMode(env: { PROD: boolean; VITE_API_MODE?: string }): ApiMode {
  return !env.PROD && env.VITE_API_MODE === 'mock' ? 'mock' : 'real';
}

let transport: Promise<Transport> | undefined;

function getTransport(): Promise<Transport> {
  transport ??= (async () => {
    // A production build replaces import.meta.env.PROD with `true`, so everything after this line
    // is unreachable there and the mock (its users and password) is left out of the bundle.
    if (import.meta.env.PROD) return fetchTransport;
    if (apiMode(import.meta.env) === 'mock') {
      console.info('[api] VITE_API_MODE=mock: answering from src/api/mock, not the server');
      return (await import('./mock')).mockTransport;
    }
    return fetchTransport;
  })();
  return transport;
}

type TemplateInput = { name: string; language: string; category: string; components: TemplateComponent[] };
type PerCategory = { marketing: number; utility: number; authentication: number };

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length > 0 ? `?${new URLSearchParams(entries)}` : '';
}

/** One typed function per route, over any transport. Screens use the default `api` below. */
export function createApi(transport: () => Transport | Promise<Transport>) {
  async function send<T>(request: ApiRequest, schema: ResponseSchema<T> | null): Promise<T> {
    return call(await transport(), request, schema);
  }
  return {
    /** POST /api/auth/login. On success the server sets the session cookie. */
    login: (body: LoginRequest) => send({ method: 'POST', path: '/api/auth/login', body }, LoginResponse),
    /** POST /api/auth/logout. Ends the session; answers 204 with no body. */
    logout: () => send({ method: 'POST', path: '/api/auth/logout' }, null),
    /** GET /api/auth/me. The logged-in user and the client workspaces they can open. */
    me: () => send({ method: 'GET', path: '/api/auth/me' }, MeResponse),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      send({ method: 'POST', path: '/api/me/password', body }, null),
    myNotifications: () => send({ method: 'GET', path: '/api/me/notifications' }, MyNotifications),
    markNotificationRead: (id: string) =>
      send({ method: 'PATCH', path: `/api/me/notifications/${id}/read` }, null),

    adminClients: () => send({ method: 'GET', path: '/api/admin/clients' }, AdminClientList),
    adminClient: (id: string) => send({ method: 'GET', path: `/api/admin/clients/${id}` }, AdminClientDetail),
    createClient: (body: { name: string; countryCallingCode: '91'; contactEmail: string }) =>
      send({ method: 'POST', path: '/api/admin/clients', body }, AdminClient),
    editClient: (id: string, body: { name?: string; contactEmail?: string }) =>
      send({ method: 'PATCH', path: `/api/admin/clients/${id}`, body }, AdminClient),
    setClientSuspended: (id: string, suspended: boolean, note: string) =>
      send({ method: 'POST', path: `/api/admin/clients/${id}/${suspended ? 'suspend' : 'reactivate'}`, body: { note } }, null),

    adminUsers: (filter: { role?: string; clientId?: string } = {}) =>
      send({ method: 'GET', path: `/api/admin/users${query(filter)}` }, AdminUserList),
    createUser: (body: {
      name: string;
      email: string;
      role: 'client' | 'staff';
      password: string;
      clientId?: string;
      clientIds?: string[];
    }) => send({ method: 'POST', path: '/api/admin/users', body }, null),
    setUserStatus: (id: string, status: 'active' | 'disabled') =>
      send({ method: 'PATCH', path: `/api/admin/users/${id}`, body: { status } }, null),
    unlockUser: (id: string) => send({ method: 'POST', path: `/api/admin/users/${id}/unlock` }, null),
    resetPassword: (id: string, password: string) =>
      send({ method: 'POST', path: `/api/admin/users/${id}/reset-password`, body: { password } }, null),
    setStaffClients: (id: string, clientIds: string[]) =>
      send({ method: 'PUT', path: `/api/admin/users/${id}/clients`, body: { clientIds } }, null),

    waAccounts: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/wa-accounts` }, WaAccountList),
    embeddedSignup: (clientId: string, body: { code: string; wabaId: string; phoneNumberId: string }) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/wa-accounts/embedded-signup`, body }, WaAccount),
    connectNumber: (clientId: string, body: { wabaId: string; phoneNumberId: string; token: string }) =>
      send({ method: 'POST', path: `/api/admin/clients/${clientId}/wa-accounts`, body }, WaAccount),
    setNumberLimits: (id: string, body: { sendRatePerSec?: number; dailySendLimit?: number | null }) =>
      send({ method: 'PATCH', path: `/api/admin/wa-accounts/${id}/limits`, body }, null),
    resumeNumber: (id: string) => send({ method: 'POST', path: `/api/admin/wa-accounts/${id}/resume` }, null),
    shareCredit: (id: string) => send({ method: 'POST', path: `/api/admin/wa-accounts/${id}/share-credit` }, null),
    replaceToken: (id: string, token: string) =>
      send({ method: 'POST', path: `/api/admin/wa-accounts/${id}/token`, body: { token } }, null),
    limitUsage: () => send({ method: 'GET', path: '/api/admin/limits-usage' }, LimitUsage),
    wordSetting: (key: string) => send({ method: 'GET', path: `/api/admin/settings/${key}` }, WordSetting),
    setWordSetting: (key: string, value: string[]) =>
      send({ method: 'PUT', path: `/api/admin/settings/${key}`, body: { value } }, null),

    templates: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/templates` }, TemplateList),
    template: (clientId: string, id: string) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/templates/${id}` }, TemplateView),
    createTemplate: (clientId: string, body: TemplateInput & { waAccountId: string }) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/templates`, body }, TemplateView),
    editTemplate: (clientId: string, id: string, body: TemplateInput) =>
      send({ method: 'PUT', path: `/api/clients/${clientId}/templates/${id}`, body }, TemplateView),
    submitTemplate: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/templates/${id}/submit` }, TemplateView),
    copyTemplate: (clientId: string, id: string, name: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/templates/${id}/copy`, body: { name } }, TemplateView),
    uploadTemplateMedia: (clientId: string, id: string, file: File) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/templates/${id}/media`, file }, TemplateView),

    uploadAudience: (clientId: string, file: Blob, fileName: string) =>
      send(
        { method: 'POST', path: `/api/clients/${clientId}/lists${query({ fileName, optIn: 'true' })}`, file },
        AudienceUploaded,
      ),
    audience: (clientId: string, id: string) => send({ method: 'GET', path: `/api/clients/${clientId}/lists/${id}` }, AudienceList),
    setNumberColumn: (clientId: string, id: string, column: number) =>
      send({ method: 'PUT', path: `/api/clients/${clientId}/lists/${id}/number-column`, body: { column } }, null),
    campaigns: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/campaigns` }, CampaignList),
    campaign: (clientId: string, id: string) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/campaigns/${id}` }, CampaignDetail),
    createCampaign: (clientId: string, body: { name: string; templateId: string; listId: string }) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns`, body }, CampaignView),
    setCampaignVariables: (clientId: string, id: string, variableMap: VariableMap) =>
      send({ method: 'PUT', path: `/api/clients/${clientId}/campaigns/${id}`, body: { variableMap } }, null),
    campaignSummary: (clientId: string, id: string) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/campaigns/${id}/summary` }, CampaignSummary),
    confirmCampaign: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/confirm` }, null),
    pauseCampaign: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/pause` }, null),
    resumeCampaign: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/resume` }, null),
    cancelCampaign: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/cancel` }, CampaignCancelled),
    scheduleCampaign: (clientId: string, id: string, at: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/schedule`, body: { at } }, CampaignScheduled),
    unscheduleCampaign: (clientId: string, id: string) =>
      send({ method: 'POST', path: `/api/clients/${clientId}/campaigns/${id}/unschedule` }, null),
    rules: () => send({ method: 'GET', path: '/api/admin/rules' }, RuleList),
    saveRule: (body: RuleInput) => send({ method: 'PUT', path: '/api/admin/rules', body }, null),
    adminCampaigns: (filter: { clientId?: string; status?: string }) =>
      send({ method: 'GET', path: `/api/admin/campaigns${query(filter)}` }, AdminCampaignList),
    campaignDiagnosis: (id: string) => send({ method: 'GET', path: `/api/admin/campaigns/${id}/diagnosis` }, CampaignDiagnosis),
    optOuts: (clientId: string) => send({ method: 'GET', path: `/api/admin/clients/${clientId}/opt-outs` }, OptOutList),
    addOptOuts: (clientId: string, numbers: string[]) =>
      send({ method: 'POST', path: `/api/admin/clients/${clientId}/opt-outs`, body: { numbers } }, OptOutsAdded),
    removeOptOut: (clientId: string, number: string) =>
      send({ method: 'DELETE', path: `/api/admin/clients/${clientId}/opt-outs/${number}` }, null),

    wallet: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/wallet` }, WalletView),
    ledger: (clientId: string, filter: { kind?: string; from?: string; to?: string; cursor?: string; limit?: string }) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/wallet/ledger${query(filter)}` }, LedgerPage),
    statement: (clientId: string, month: string) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/wallet/statement${query({ month })}` }, StatementView),
    prices: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/prices` }, PriceList),

    topUp: (clientId: string, body: { amountPaise: number; note?: string }) =>
      send({ method: 'POST', path: `/api/admin/clients/${clientId}/wallet/topups`, body }, null),
    adjust: (clientId: string, body: { amountPaise: number; note: string }) =>
      send({ method: 'POST', path: `/api/admin/clients/${clientId}/wallet/adjustments`, body }, null),
    setLowBalanceAlert: (clientId: string, alertPaise: number | null) =>
      send({ method: 'PATCH', path: `/api/admin/clients/${clientId}/low-balance-alert`, body: { alertPaise } }, null),
    clientPricing: (clientId: string) =>
      send({ method: 'GET', path: `/api/admin/clients/${clientId}/pricing` }, ClientPricingView),
    setClientPricing: (
      clientId: string,
      body:
        | { mode: 'default' }
        | { mode: 'markup'; markupBp: PerCategory }
        | { mode: 'fixed'; fixedPaise: PerCategory },
    ) => send({ method: 'PUT', path: `/api/admin/clients/${clientId}/pricing`, body }, null),
    defaultPricing: () => send({ method: 'GET', path: '/api/admin/pricing' }, DefaultPricingView),
    setDefaultPricing: (markupBp: PerCategory) =>
      send({ method: 'PUT', path: '/api/admin/pricing', body: { markupBp } }, null),
    metaRates: () => send({ method: 'GET', path: '/api/admin/meta-rates' }, MetaRateList),
    addMetaRate: (body: { category: string; countryCallingCode: '91'; rateCentipaise: number; validFrom: string }) =>
      send({ method: 'POST', path: '/api/admin/meta-rates', body }, null),
    chargePolicy: (clientId?: string) =>
      send({ method: 'GET', path: `/api/admin/charge-policy${query({ clientId })}` }, ChargePolicyView),
    setChargePolicy: (body: { clientId?: string; outcome: string; charged: boolean }) =>
      send({ method: 'PUT', path: '/api/admin/charge-policy', body }, null),
    gstRates: () => send({ method: 'GET', path: '/api/admin/gst-rates' }, GstRateList),
    addGstRate: (body: { rateBp: number; validFrom: string }) =>
      send({ method: 'POST', path: '/api/admin/gst-rates', body }, null),
    gstReport: (month: string) => send({ method: 'GET', path: `/api/admin/gst-report${query({ month })}` }, GstReport),

    dashboard: (clientId: string) => send({ method: 'GET', path: `/api/clients/${clientId}/dashboard` }, DashboardView),
    monthlyReport: (clientId: string, month: string) =>
      send({ method: 'GET', path: `/api/clients/${clientId}/reports/monthly${query({ month })}` }, MonthlyReport),
    metaView: (month: string) => send({ method: 'GET', path: `/api/admin/meta-view${query({ month })}` }, MetaView),
    setCreditLimit: (limitPaise: number) =>
      send({ method: 'PUT', path: '/api/admin/credit-limit', body: { limitPaise } }, null),
    metaInvoices: () => send({ method: 'GET', path: '/api/admin/meta-invoices' }, MetaInvoiceList),
    addMetaInvoice: (body: { month: string; totalPaise: number; perAccount?: Record<string, number> }) =>
      send({ method: 'POST', path: '/api/admin/meta-invoices', body }, MetaInvoiceCheck),

    audit: (filter: { clientId?: string; userId?: string; action?: string; from?: string; to?: string; cursor?: string }) =>
      send({ method: 'GET', path: `/api/admin/audit${query(filter)}` }, AuditPage),
    deliveryLog: (status?: string) =>
      send({ method: 'GET', path: `/api/admin/notifications${query({ status })}` }, DeliveryLog),
  };
}

export type Api = ReturnType<typeof createApi>;

/** The panel's API: the real server, or the mock when VITE_API_MODE=mock in development. */
export const api: Api = createApi(getTransport);
export const { login, logout, me } = api;
