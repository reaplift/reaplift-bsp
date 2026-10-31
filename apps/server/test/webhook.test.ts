import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { unusedDb } from './support/unused-db.js';

describe('Meta webhook flow', () => {
  it('verifies the callback challenge for a valid token', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => true,
      db: unusedDb(),
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
      db: unusedDb(),
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

  it('refuses the callback check when no verify token is configured', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true, db: unusedDb() });

    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.challenge=challenge-123&hub.verify_token=',
    });

    expect(res.statusCode).toBe(403);
  });
});
