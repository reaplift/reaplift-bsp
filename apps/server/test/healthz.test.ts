import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { unusedDb } from './support/unused-db.js';

describe('GET /healthz', () => {
  it('returns 200 with the version when the database answers', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true, db: unusedDb() });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'abc123', db: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => false, db: unusedDb() });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', version: 'abc123', db: 'down' });
  });
});

describe('every answer', () => {
  it('carries headers that stop framing, type guessing and caching', async () => {
    const app = buildApp({ version: 'abc123', checkDb: async () => true, db: unusedDb() });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('an unexpected error answers in general terms, without its internal message', async () => {
    const app = buildApp({
      version: 'abc123',
      checkDb: async () => {
        throw new Error('relation "secret_table" does not exist at /app/src/x.ts');
      },
      db: unusedDb(),
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
    expect(res.body).not.toContain('secret_table');
  });
});

