import { describe, expect, it } from 'vitest';
import {
  buildTemplateMessagePayload,
  classifyMetaError,
  extractMetaMessageId,
  isRetryableMetaError,
} from '../src/lib/meta-client.js';

describe('meta client', () => {
  it('classifies account-level pauses and permanent template issues', () => {
    expect(classifyMetaError(190)).toMatchObject({ category: 'account', retryable: false, pauseAccount: true });
    expect(classifyMetaError(131009)).toMatchObject({ category: 'permanent', retryable: false });
    expect(classifyMetaError(131049)).toMatchObject({ category: 'permanent', retryable: false });
  });

  it('marks transient HTTP and rate-limit failures as retryable', () => {
    expect(isRetryableMetaError(500)).toBe(true);
    expect(isRetryableMetaError(130429)).toBe(true);
    expect(isRetryableMetaError(80007)).toBe(true);
    expect(isRetryableMetaError(131056)).toBe(true);
  });

  it('treats unknown codes as transient unless explicitly permanent', () => {
    expect(classifyMetaError(999999)).toMatchObject({ category: 'transient', retryable: true });
    expect(classifyMetaError(undefined)).toMatchObject({ category: 'transient', retryable: true });
  });

  it('builds the WhatsApp template payload with variables', () => {
    const payload = buildTemplateMessagePayload({
      to: '919812345678',
      templateName: 'hello_world',
      language: 'en_US',
      variables: ['Amit', '2026-10-18'],
    });

    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919812345678',
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' },
      },
    });
    expect(payload.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Amit' },
          { type: 'text', text: '2026-10-18' },
        ],
      },
    ]);
  });

  it('extracts the Meta message id from a successful send response', () => {
    const payload = {
      messages: [{ id: 'wamid.HBg...' }],
    };

    expect(extractMetaMessageId(payload)).toBe('wamid.HBg...');
    expect(extractMetaMessageId({})).toBeUndefined();
  });
});
