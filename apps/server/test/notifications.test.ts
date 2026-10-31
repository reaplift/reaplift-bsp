import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/db.js';
import { CATALOGUE } from '../src/modules/notifications/catalogue.js';
import { retryDelayMs } from '../src/modules/notifications/delivery.js';
import { notify } from '../src/modules/notifications/notify.js';
import { unusedDb } from './support/unused-db.js';

describe('notify()', () => {
  it('accepts only a transaction (checked by `pnpm typecheck`)', () => {
    const db = unusedDb();
    // @ts-expect-error a plain Kysely instance is not a transaction, so notify() outside one does not compile
    const outsideTransaction = () => notify(db, 'system.test', { email: 'a@b.co', entityId: 'x' });
    expect(outsideTransaction).toBeTypeOf('function');
  });

  it('refuses an event that is not in the catalogue', async () => {
    const trx = {} as Transaction<Database>;
    // @ts-expect-error not a catalogue event
    await expect(notify(trx, 'no.such.event', { entityId: 'x' })).rejects.toThrow(
      /unknown notification event/,
    );
  });
});

describe('delivery retries', () => {
  it('waits 30 s, 1 min, 2 min, 4 min after failures 1 to 4', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });
});

describe('catalogue', () => {
  it('renders the test event', () => {
    const t = CATALOGUE['system.test'];
    expect(t.subject({})).toBe('ReapLift test notification');
    expect(t.text({ requestedAt: '2026-10-29T10:00:00Z' })).toContain('2026-10-29T10:00:00Z');
  });
});
