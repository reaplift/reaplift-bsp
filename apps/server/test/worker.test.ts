import { describe, expect, it } from 'vitest';
import { calculateNextAttemptAt, claimQueuedMessages } from '../src/lib/worker.js';

describe('worker queue helpers', () => {
  it('backs off exponentially for retryable sends', () => {
    const base = new Date('2026-10-24T12:00:00.000Z');

    expect(calculateNextAttemptAt(1, base).toISOString()).toBe('2026-10-24T12:00:30.000Z');
    expect(calculateNextAttemptAt(2, base).toISOString()).toBe('2026-10-24T12:01:00.000Z');
    expect(calculateNextAttemptAt(5, base).toISOString()).toBe('2026-10-24T12:08:00.000Z');
  });

  it('returns the SQL update contract for claiming queued rows', () => {
    const sql = claimQueuedMessages({ limit: 50, now: new Date('2026-10-24T12:00:00.000Z') });

    expect(sql).toContain('update messages');
    expect(sql).toContain('set status = \'sending\'');
    expect(sql).toContain('attempts = attempts + 1');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('limit 50');
  });
});
