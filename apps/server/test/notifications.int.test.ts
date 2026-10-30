import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliverDue, MAX_ATTEMPTS, retryDelayMs } from '../src/modules/notifications/delivery.js';
import { FakeEmailProvider } from '../src/modules/notifications/email.js';
import {
  notify,
  resolveRecipients,
  type NotifyScope,
} from '../src/modules/notifications/notify.js';
import type { RecipientRule } from '../src/modules/notifications/catalogue.js';
import { createWorld } from './support/world.js';

let w: Awaited<ReturnType<typeof createWorld>>;
const userId = async (email: string) =>
  (await sql<{ id: string }>`select id from users where email = ${email}`.execute(w.db)).rows[0]!
    .id;
const rows = async () =>
  (
    await sql<{
      email: string;
      status: string;
      attempts: number;
      last_error: string | null;
      next_attempt_at: Date;
    }>`
      select email, status, attempts, last_error, next_attempt_at from notifications order by email`.execute(
      w.db,
    )
  ).rows;
const queueTest = (email: string, entityId = email) =>
  w.db.transaction().execute((trx) => notify(trx, 'system.test', { email, entityId }));
/** A moment safely after rows written with the database's now(). */
const soon = () => new Date(Date.now() + 1000);

beforeAll(async () => {
  w = await createWorld();
});
afterAll(() => w.close());
beforeEach(async () => {
  await sql`truncate notifications`.execute(w.db);
});

describe('2.1 notify()', () => {
  it('writes nothing when the transaction rolls back', async () => {
    await expect(
      w.db.transaction().execute(async (trx) => {
        await notify(trx, 'system.test', { email: 'x@example.com', entityId: 'e1' });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await rows()).toEqual([]);
  });

  it('writes one row per recipient, and a replay writes nothing', async () => {
    expect(await queueTest('x@example.com', 'e1')).toBe(1);
    expect(await queueTest('x@example.com', 'e1')).toBe(0);
    expect((await rows()).map((r) => [r.email, r.status, r.attempts])).toEqual([
      ['x@example.com', 'pending', 0],
    ]);
  });
});

describe('2.3 recipient rules', () => {
  const resolve = (rules: RecipientRule[], scope: NotifyScope) =>
    w.db
      .transaction()
      .execute(async (trx) =>
        (await resolveRecipients(trx, rules, scope)).map((r) => r.email).sort(),
      );

  it('client_users: the active client users of that client only', async () => {
    expect(await resolve(['client_users'], { clientId: w.ids.northwind })).toEqual([
      'ops@northwind.com',
    ]);
    expect(await resolve(['client_users'], { clientId: w.ids.greenleaf })).toEqual([
      'sales@greenleaf.in',
    ]);
  });

  it('assigned_staff: staff assigned to that client only', async () => {
    expect(await resolve(['assigned_staff'], { clientId: w.ids.northwind })).toEqual([
      'meera@reaplift.com',
    ]);
    expect(await resolve(['assigned_staff'], { clientId: w.ids.greenleaf })).toEqual([]);
  });

  it("an event for Greenleaf never reaches Northwind's users or staff", async () => {
    expect(
      await resolve(['client_users', 'assigned_staff'], { clientId: w.ids.greenleaf }),
    ).toEqual(['sales@greenleaf.in']);
  });

  it('super_admins, actor and user', async () => {
    expect(await resolve(['super_admins'], {})).toEqual(['ravi@reaplift.com']);
    expect(await resolve(['actor'], { actorId: await userId('meera@reaplift.com') })).toEqual([
      'meera@reaplift.com',
    ]);
    expect(await resolve(['user'], { userId: await userId('sales@greenleaf.in') })).toEqual([
      'sales@greenleaf.in',
    ]);
  });

  it('lists an address once when two rules find it', async () => {
    const ravi = await userId('ravi@reaplift.com');
    expect(await resolve(['actor', 'super_admins'], { actorId: ravi })).toEqual([
      'ravi@reaplift.com',
    ]);
  });

  it('a disabled user gets nothing', async () => {
    await sql`update users set status = 'disabled' where email = 'ops@northwind.com'`.execute(w.db);
    try {
      expect(await resolve(['client_users'], { clientId: w.ids.northwind })).toEqual([]);
      expect(await resolve(['user'], { userId: await userId('ops@northwind.com') })).toEqual([]);
    } finally {
      await sql`update users set status = 'active' where email = 'ops@northwind.com'`.execute(w.db);
    }
  });

  it('a rule without the scope it needs is an error, not a silent empty list', async () => {
    await expect(resolve(['client_users'], {})).rejects.toThrow(/scope.clientId/);
  });
});

describe('2.2 delivery loop', () => {
  it('sends a pending email once and marks it sent', async () => {
    await queueTest('x@example.com');
    const provider = new FakeEmailProvider();
    expect(await deliverDue(w.db, provider, soon())).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(provider.sent).toMatchObject([
      { to: 'x@example.com', subject: 'ReapLift test notification' },
    ]);
    expect((await rows())[0]).toMatchObject({ status: 'sent', attempts: 1 });

    expect(await deliverDue(w.db, provider, new Date(Date.now() + 3600_000))).toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(provider.sent).toHaveLength(1);
  });

  it('two loops running at once never send the same row', async () => {
    for (let i = 0; i < 40; i++) await queueTest(`user${i}@example.com`);
    const a = new FakeEmailProvider();
    const b = new FakeEmailProvider();
    await Promise.all([deliverDue(w.db, a, soon()), deliverDue(w.db, b, soon())]);
    const all = [...a.sent, ...b.sent].map((e) => e.to);
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });

  it('retries after 30 s, 1, 2 and 4 minutes, then fails for good after 5 attempts', async () => {
    await queueTest('x@example.com');
    const provider = new FakeEmailProvider(undefined, 'SMTP timeout');
    let now = soon();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await deliverDue(w.db, provider, now)).toEqual({ sent: 0, retried: 1, failed: 0 });
      const row = (await rows())[0]!;
      expect(row).toMatchObject({
        status: 'pending',
        attempts: attempt,
        last_error: 'SMTP timeout',
      });
      expect(row.next_attempt_at.getTime() - now.getTime()).toBe(retryDelayMs(attempt));
      // Not due yet: nothing is claimed a second early.
      expect(
        await deliverDue(w.db, provider, new Date(now.getTime() + retryDelayMs(attempt) - 1000)),
      ).toEqual({
        sent: 0,
        retried: 0,
        failed: 0,
      });
      now = new Date(now.getTime() + retryDelayMs(attempt));
    }
    expect(await deliverDue(w.db, provider, now)).toEqual({ sent: 0, retried: 0, failed: 1 });
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      attempts: 5,
      last_error: 'SMTP timeout',
    });
    provider.fail = null;
    expect(await deliverDue(w.db, provider, new Date(now.getTime() + 3600_000))).toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
  });
});
