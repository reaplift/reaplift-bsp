import { describe, expect, it, vi } from 'vitest';
import {
  buildTemplateMessagePayload,
  classifyMetaError,
  extractMetaMessageId,
  isRetryableMetaError,
  MetaClient,
} from '../src/lib/meta-client.js';

describe('meta client', () => {
  it('classifies account-level pauses and permanent template issues', () => {
    expect(classifyMetaError(190)).toMatchObject({ category: 'account', retryable: false, pauseAccount: true });
    expect(classifyMetaError(131009)).toMatchObject({ category: 'permanent', retryable: false });
    expect(classifyMetaError(131049)).toMatchObject({ category: 'permanent', retryable: false });
  });

  it('classifies the codes checked against Meta on 30 October 2026', () => {
    for (const code of [190, 0, 3, 10, 200, 299, 368, 131005, 131031, 131042, 133010]) {
      expect(classifyMetaError(code).category, String(code)).toBe('account');
    }
    for (const code of [100, 131008, 131009, 131026, 131047, 131048, 131049, 131050, 132000, 132001, 132015]) {
      expect(classifyMetaError(code).category, String(code)).toBe('permanent');
    }
    for (const code of [1, 2, 4, 80007, 130429, 131000, 131016, 131056, 133004]) {
      expect(classifyMetaError(code).category, String(code)).toBe('transient');
    }
  });

  it('sends no components for a template without variables', () => {
    const payload = buildTemplateMessagePayload({
      to: '919812345678',
      templateName: 'hello_world',
      language: 'en_US',
      variables: [],
    });

    expect(payload.template).toEqual({ name: 'hello_world', language: { code: 'en_US' } });
  });

  it('puts callback data at the top level of the message, only when given', () => {
    const input = { to: '919812345678', templateName: 'hello_world', language: 'en_US', variables: [] };

    expect(buildTemplateMessagePayload({ ...input, callbackData: '42' })).toMatchObject({
      biz_opaque_callback_data: '42',
    });
    expect(buildTemplateMessagePayload(input)).not.toHaveProperty('biz_opaque_callback_data');
  });

  it('waits 30 seconds for Meta by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));

    await new MetaClient({ baseUrl: 'http://fake', version: 'v26.0' }).listPhoneNumbers('waba', 'token');

    expect(timeout).toHaveBeenCalledWith(30_000);
    vi.unstubAllGlobals();
    timeout.mockRestore();
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
