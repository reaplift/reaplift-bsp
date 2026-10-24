export type MetaErrorCategory = 'account' | 'permanent' | 'transient';

export interface MetaErrorClassification {
  category: MetaErrorCategory;
  retryable: boolean;
  pauseAccount?: boolean;
  reason?: string;
}

const ACCOUNT_PAUSE_CODES = new Set([190, 131031, 131042]);
const PERMANENT_CODES = new Set([100, 131009, 131026, 132000, 132001, 132015, 131049]);
const RETRYABLE_CODES = new Set([4, 500, 80007, 130429, 131056]);

export function classifyMetaError(code?: number): MetaErrorClassification {
  if (code === undefined) {
    return { category: 'transient', retryable: true, reason: 'unknown meta error' };
  }

  if (ACCOUNT_PAUSE_CODES.has(code)) {
    return { category: 'account', retryable: false, pauseAccount: true, reason: `meta account paused: ${code}` };
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
}

export function buildTemplateMessagePayload({
  to,
  templateName,
  language,
  variables,
}: BuildTemplateMessagePayloadInput) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        {
          type: 'body',
          parameters: variables.map((value) => ({ type: 'text', text: value })),
        },
      ],
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
