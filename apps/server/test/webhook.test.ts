import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('Meta webhook flow', () => {
  it('verifies the callback challenge for a valid token', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => true,
      metaVerifyToken: 'reaplift-verify',
      metaAppSecret: 'super-secret',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.challenge=challenge-123&hub.verify_token=reaplift-verify',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('challenge-123');
  });

  it('rejects tampered webhook payloads', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => true,
      metaVerifyToken: 'reaplift-verify',
      metaAppSecret: 'super-secret',
    });

    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=bad',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid signed webhook payload', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => true,
      metaVerifyToken: 'reaplift-verify',
      metaAppSecret: 'super-secret',
    });

    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const signature = createHmac('sha256', 'super-secret').update(body, 'utf8').digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('checks the signature against the bytes received, not a re-serialised body', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => true,
      metaVerifyToken: 'reaplift-verify',
      metaAppSecret: 'super-secret',
    });

    // Meta's spacing differs from JSON.stringify, so re-serialising would break the signature.
    const body = '{ "object": "whatsapp_business_account",\n  "entry": [] }';
    const signature = createHmac('sha256', 'super-secret').update(body, 'utf8').digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
  });
});
