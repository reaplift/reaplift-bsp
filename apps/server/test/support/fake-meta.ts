import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MetaTemplate } from '../../src/lib/meta-client.js';

export interface FakeRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
  at: number;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
  delayMs?: number;
  /** Meta accepts the message before answering, so a client that times out never sees the ID. */
  acceptFirst?: boolean;
}

export const metaError = (status: number, code: number, message = `error ${code}`): FakeResponse => ({
  status,
  body: { error: { code, message } },
});

export const HELLO_WORLD: MetaTemplate = {
  id: 'tmpl-hello',
  name: 'hello_world',
  language: 'en_US',
  category: 'UTILITY',
  status: 'APPROVED',
  components: [{ type: 'BODY', text: 'Hello World' }],
};

export interface FakeMetaOptions {
  /** After each accepted send, called with the phone's status updates. */
  onAccepted?: (metaMessageId: string, to: string, callbackData?: string) => void;
}

/** Stands in for Meta's Graph API over real HTTP, so tests exercise the same client production uses. */
export class FakeMeta {
  readonly requests: FakeRequest[] = [];
  /** Every wamid given out, including those whose answer came too late for the client to see. */
  readonly accepted: string[] = [];
  templates: MetaTemplate[] = [HELLO_WORLD];
  templatePageSize = 100;
  phoneNumbers = [{ id: 'phone-1', display_phone_number: '+91 98000 00000', verified_name: 'ReapLift Test' }];
  validToken = 'good-token';
  systemToken = 'system-token';
  businessToken = 'business-token';
  validCode = 'good-code';
  /** Answer for the next credit-line share; after that, each succeeds. */
  creditResponses: FakeResponse[] = [];
  registerResponses: FakeResponse[] = [];
  quality = 'GREEN';
  /** Every Nth send fails with error 131026, for the load test. */
  failEvery = 0;
  private sendCount = 0;
  messagingLimit = 'TIER_2K';
  /** Answers for the next template create or edit calls, in order; after that, each succeeds. */
  templateResponses: FakeResponse[] = [];
  /** Answers for the next send calls, in order; after that, every send succeeds. */
  private queued: FakeResponse[] = [];
  private nextId = 1;
  /** Keeps IDs unique when the fake restarts, as Meta's are. */
  private readonly runId = Date.now().toString(36);
  private server: Server | undefined;

  constructor(private readonly options: FakeMetaOptions = {}) {}

  queueSendResponses(...responses: FakeResponse[]) {
    this.queued.push(...responses);
  }

  sends() {
    return this.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'));
  }

  async start(port = 0): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        void this.answer(req.method ?? '', req.url ?? '', req.headers.authorization, raw).then(
          ({ status, body }) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body ?? {}));
          },
        );
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(resolve);
    });
  }

  private accept(raw: string): string {
    const id = `wamid.fake-${this.runId}-${this.nextId++}`;
    const { to, biz_opaque_callback_data: callbackData } = JSON.parse(raw) as {
      to: string;
      biz_opaque_callback_data?: string;
    };
    this.accepted.push(id);
    this.options.onAccepted?.(id, to, callbackData);
    return id;
  }

  private async answer(
    method: string,
    url: string,
    authorization: string | undefined,
    raw: string,
  ): Promise<FakeResponse> {
    const parsed = new URL(url, 'http://fake');
    const path = parsed.pathname;
    this.requests.push({
      method,
      path,
      authorization,
      body: raw && !path.includes('upload:') ? JSON.parse(raw) : undefined,
      at: Date.now(),
    });

    if (method === 'POST' && path.endsWith('/messages')) {
      this.sendCount += 1;
      if (this.failEvery && this.sendCount % this.failEvery === 0) return metaError(400, 131026);
      const next = this.queued.shift();
      const accepted = !next || next.acceptFirst ? this.accept(raw) : undefined;
      if (next?.delayMs) await new Promise((resolve) => setTimeout(resolve, next.delayMs));
      if (next && !accepted) return next;
      return { status: 200, body: { messaging_product: 'whatsapp', messages: [{ id: accepted }] } };
    }

    if (path.endsWith('/oauth/access_token')) {
      return parsed.searchParams.get('code') === this.validCode
        ? { status: 200, body: { access_token: this.businessToken, token_type: 'bearer' } }
        : metaError(400, 100, 'Invalid code');
    }
    if (path.endsWith('/whatsapp_credit_sharing_and_attach')) {
      if (authorization !== `Bearer ${this.systemToken}`) return metaError(401, 190, 'Not the system token');
      return (
        this.creditResponses.shift() ?? {
          status: 200,
          body: { allocation_config_id: 'alloc-1', waba_id: parsed.searchParams.get('waba_id') },
        }
      );
    }
    if (path.endsWith('/uploads') && method === 'POST') return { status: 200, body: { id: 'upload:session-1' } };
    if (path.endsWith('/upload:session-1')) {
      if (!authorization?.startsWith('OAuth ')) return metaError(401, 190, 'Upload needs an OAuth header');
      return { status: 200, body: { h: 'handle-1' } };
    }

    if (authorization !== `Bearer ${this.validToken}` && authorization !== `Bearer ${this.businessToken}`) {
      return metaError(401, 190, 'Invalid OAuth access token');
    }
    if (method === 'POST' && path.endsWith('/subscribed_apps')) return { status: 200, body: { success: true } };
    if (method === 'POST' && path.endsWith('/register')) {
      return this.registerResponses.shift() ?? { status: 200, body: { success: true } };
    }
    if (method === 'POST') {
      const next = this.templateResponses.shift();
      if (next) return next;
      const body = JSON.parse(raw) as Partial<MetaTemplate>;
      if (path.endsWith('/message_templates')) {
        const id = `tmpl-${this.nextId++}`;
        this.templates.push({ ...(body as MetaTemplate), id, status: 'PENDING' });
        return { status: 200, body: { id, status: 'PENDING', category: body.category } };
      }
      const template = this.templates.find((t) => path.endsWith(`/${t.id}`));
      if (!template) return metaError(400, 100, `unknown template ${path}`);
      Object.assign(template, body, { status: 'PENDING' });
      return { status: 200, body: { success: true } };
    }
    if (this.phoneNumbers.some((n) => path.endsWith(`/${n.id}`))) {
      return {
        status: 200,
        body: { quality_rating: this.quality, whatsapp_business_manager_messaging_limit: this.messagingLimit },
      };
    }
    if (path.endsWith('/phone_numbers')) return { status: 200, body: { data: this.phoneNumbers } };
    if (path.endsWith('/message_templates')) {
      const start = Number(parsed.searchParams.get('after') ?? 0);
      const end = start + this.templatePageSize;
      return {
        status: 200,
        body: {
          data: this.templates.slice(start, end),
          paging:
            end < this.templates.length
              ? { cursors: { after: String(end) }, next: 'https://fake/next' }
              : {},
        },
      };
    }
    return metaError(400, 100, `unknown path ${path}`);
  }
}

/** The body Meta posts for one status update. */
export function statusWebhook(
  metaMessageId: string,
  status: string,
  timestamp: number,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              statuses: [{ id: metaMessageId, status, timestamp: String(timestamp), ...extra }],
            },
          },
        ],
      },
    ],
  });
}

/** The body Meta posts when a template's status changes. */
export function templateWebhook(metaTemplateId: string, event: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'message_template_status_update',
            value: { event, message_template_id: metaTemplateId, reason: 'NONE', ...extra },
          },
        ],
      },
    ],
  });
}

export const signWebhook = (body: string, secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
