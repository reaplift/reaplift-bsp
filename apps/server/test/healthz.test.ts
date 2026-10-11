import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /healthz', () => {
  it('returns 200 with the version when the database answers', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'abc123', db: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', version: 'abc123', db: 'down' });
  });
});
