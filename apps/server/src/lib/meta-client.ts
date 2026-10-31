export type MetaErrorCategory = 'account' | 'permanent' | 'transient';

export interface MetaErrorClassification {
  category: MetaErrorCategory;
  retryable: boolean;
  pauseAccount?: boolean;
  reason?: string;
}

// Checked against Meta's error-code page on 30 October 2026:
// https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
// Re-check before relying on these. A code that is not listed retries, up to the sender's attempt limit.

/** The account's token, permissions, restrictions or payment: every message would fail, so stop sending. */
const ACCOUNT_PAUSE_CODES = new Set([0, 3, 10, 190, 368, 131005, 131031, 131042, 133010]);
/** This message can never succeed as it is. 131049: Meta says wait at least 24 hours, so never retried automatically. */
const PERMANENT_CODES = new Set([
  100, 130472, 131008, 131009, 131021, 131026, 131047, 131048, 131049, 131050, 131051, 131053,
  132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069,
]);
const RETRYABLE_CODES = new Set([1, 2, 4, 500, 80007, 130429, 131000, 131016, 131056, 131057, 133004]);

function isPermissionCode(code: number): boolean {
  return code >= 200 && code <= 299;
}

export function classifyMetaError(code?: number): MetaErrorClassification {
  if (code === undefined) {
    return { category: 'transient', retryable: true, reason: 'unknown meta error' };
  }

  if (ACCOUNT_PAUSE_CODES.has(code) || isPermissionCode(code)) {
    return {
      category: 'account',
      retryable: false,
      pauseAccount: true,
      reason: `meta account paused: ${code}`,
    };
  }

  if (PERMANENT_CODES.has(code)) {
    return { category: 'permanent', retryable: false, reason: `meta permanent error: ${code}` };
  }

  if (RETRYABLE_CODES.has(code)) {
    return { category: 'transient', retryable: true, reason: `meta retryable error: ${code}` };
  }

  return { category: 'transient', retryable: true, reason: `meta unknown error: ${code}` };
}

export function isRetryableMetaError(code?: number): boolean {
  return classifyMetaError(code).retryable;
}

export interface BuildTemplateMessagePayloadInput {
  to: string;
  templateName: string;
  language: string;
  variables: string[];
  /** Our message ID. Meta returns it in status webhooks, so a send that timed out can still be recognised. */
  callbackData?: string;
}

export function buildTemplateMessagePayload({
  to,
  templateName,
  language,
  variables,
  callbackData,
}: BuildTemplateMessagePayloadInput) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    ...(callbackData !== undefined && { biz_opaque_callback_data: callbackData }),
    template: {
      name: templateName,
      language: { code: language },
      // A template without variables, such as hello_world, takes no components.
      ...(variables.length > 0 && {
        components: [
          {
            type: 'body',
            parameters: variables.map((value) => ({ type: 'text', text: value })),
          },
        ],
      }),
    },
  };
}

export function extractMetaMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('messages' in payload)) {
    return undefined;
  }

  const messages = (payload as { messages?: Array<{ id?: string }> }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }

  return messages[0]?.id;
}

export interface MetaFailure {
  ok: false;
  /** Absent when no response came back (network error, timeout). */
  httpStatus?: number;
  code?: number;
  title: string;
}

export type MetaResult<T> = { ok: true; data: T } | MetaFailure;

export interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components?: unknown[];
  rejected_reason?: string;
}

export interface MetaTemplateRequest {
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

export interface MetaPhoneHealth {
  quality_rating?: string;
  whatsapp_business_manager_messaging_limit?: string;
}

interface MetaClientOptions {
  baseUrl: string;
  version: string;
  timeoutMs?: number;
}

/** Meta's Graph API. The token is passed per call because each WhatsApp account has its own, and only ever goes in a header. */
export class MetaClient {
  private readonly root: string;
  private readonly timeoutMs: number;

  constructor({ baseUrl, version, timeoutMs = 30_000 }: MetaClientOptions) {
    this.root = `${baseUrl.replace(/\/$/, '')}/${version}`;
    this.timeoutMs = timeoutMs;
  }

  sendMessage(
    phoneNumberId: string,
    token: string,
    payload: ReturnType<typeof buildTemplateMessagePayload>,
  ): Promise<MetaResult<unknown>> {
    return this.request(`/${encodeURIComponent(phoneNumberId)}/messages`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  listPhoneNumbers(wabaId: string, token: string) {
    return this.request<{ data: MetaPhoneNumber[] }>(
      `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name`,
      token,
    );
  }

  createTemplate(wabaId: string, token: string, template: MetaTemplateRequest) {
    return this.request<{ id?: string }>(`/${encodeURIComponent(wabaId)}/message_templates`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(template),
    });
  }

  /** Replaces a template's category and components; Meta does not allow changing its name or language. */
  editTemplate(metaTemplateId: string, token: string, edit: Pick<MetaTemplateRequest, 'category' | 'components'>) {
    return this.request<{ success?: boolean }>(`/${encodeURIComponent(metaTemplateId)}`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edit),
    });
  }

  /** The code from Embedded Signup lasts about 30 seconds. The secret goes in the query, as Meta's API requires, and is never logged. */
  async exchangeCode(appId: string, appSecret: string, code: string): Promise<MetaResult<{ access_token?: string }>> {
    const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    return this.request(`/oauth/access_token?${query}`, '');
  }

  subscribeApp(wabaId: string, token: string) {
    return this.request<{ success?: boolean }>(`/${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: 'POST' });
  }

  /** Uses the system user's token, and bills the customer's account to ReapLift's credit line. */
  shareCreditLine(creditLineId: string, systemToken: string, wabaId: string, currency: string) {
    const query = new URLSearchParams({ waba_currency: currency, waba_id: wabaId });
    return this.request<{ allocation_config_id?: string }>(
      `/${encodeURIComponent(creditLineId)}/whatsapp_credit_sharing_and_attach?${query}`,
      systemToken,
      { method: 'POST' },
    );
  }

  registerNumber(phoneNumberId: string, token: string, pin: string) {
    return this.request<{ success?: boolean }>(`/${encodeURIComponent(phoneNumberId)}/register`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
  }

  /** Meta's Resumable Upload API, in one go: returns the handle a media header's review sample needs. */
  async uploadSample(
    appId: string,
    token: string,
    file: { name: string; type: string; bytes: Buffer },
  ): Promise<MetaResult<{ h?: string }>> {
    const query = new URLSearchParams({
      file_name: file.name,
      file_length: String(file.bytes.length),
      file_type: file.type,
    });
    const session = await this.request<{ id?: string }>(`/${encodeURIComponent(appId)}/uploads?${query}`, token, {
      method: 'POST',
    });
    if (!session.ok) return session;
    return this.request<{ h?: string }>(`/${session.data.id ?? ''}`, token, {
      method: 'POST',
      headers: { authorization: `OAuth ${token}`, file_offset: '0' },
      body: new Uint8Array(file.bytes),
    });
  }

  phoneHealth(phoneNumberId: string, token: string) {
    return this.request<MetaPhoneHealth>(
      `/${encodeURIComponent(phoneNumberId)}?fields=quality_rating,whatsapp_business_manager_messaging_limit`,
      token,
    );
  }

  /** Every template of the account, following Meta's pages. */
  async listTemplates(wabaId: string, token: string): Promise<MetaResult<MetaTemplate[]>> {
    const all: MetaTemplate[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({
        fields: 'id,name,language,category,status,components,rejected_reason',
        limit: '100',
        ...(after ? { after } : {}),
      });
      const page = await this.request<{
        data: MetaTemplate[];
        paging?: { next?: string; cursors?: { after?: string } };
      }>(`/${encodeURIComponent(wabaId)}/message_templates?${query}`, token);
      if (!page.ok) return page;
      all.push(...page.data.data);
      after = page.data.paging?.next ? page.data.paging.cursors?.after : undefined;
    } while (after);
    return { ok: true, data: all };
  }

  private async request<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<MetaResult<T>> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${this.root}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      return { ok: false, title: err instanceof Error ? err.name : 'network error' };
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    if (res.ok && body !== undefined) return { ok: true, data: body as T };
    const error = (body as { error?: { code?: number; message?: string } } | undefined)?.error;
    return {
      ok: false,
      httpStatus: res.status,
      ...(typeof error?.code === 'number' ? { code: error.code } : {}),
      title: error?.message ?? `HTTP ${res.status}`,
    };
  }
}
