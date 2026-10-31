import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { CATALOGUE, isEventName, type Payload } from './catalogue.js';
import type { EmailProvider } from './email.js';

export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 50;
/** A claimed row is hidden from other loops this long; if this process dies, the row comes back after it. */
export const CLAIM_LEASE_MS = 2 * 60 * 1000;

/** Wait before the next try after `attempts` failed tries: 30 s, 1 min, 2 min, 4 min. */
export function retryDelayMs(attempts: number): number {
  return 30_000 * 2 ** (attempts - 1);
}

interface ClaimedRow {
  id: string;
  email: string;
  event: string;
  payload: Payload;
  attempts: number;
}

/**
 * Sends every email notification that is due, once. Claiming pushes the row's next attempt past the lease
 * in one statement with `for update skip locked`, so two loops never pick the same row.
 */
export async function deliverDue(
  db: Kysely<Database>,
  provider: EmailProvider,
  now: Date = new Date(),
  log?: Logger,
): Promise<{ sent: number; retried: number; failed: number }> {
  const claimed = (
    await sql<ClaimedRow>`
      update notifications
      set attempts = attempts + 1, next_attempt_at = ${new Date(now.getTime() + CLAIM_LEASE_MS)}
      where id in (
        select id from notifications
        where channel = 'email' and status = 'pending' and next_attempt_at <= ${now}
        order by next_attempt_at
        limit ${BATCH_SIZE}
        for update skip locked
      )
      returning id, email, event, payload, attempts
    `.execute(db)
  ).rows;

  const outcome = { sent: 0, retried: 0, failed: 0 };
  for (const row of claimed) {
    try {
      if (!isEventName(row.event)) throw new Error(`event "${row.event}" is not in the catalogue`);
      const definition = CATALOGUE[row.event];
      await provider.send({
        to: row.email,
        subject: definition.subject(row.payload),
        text: definition.text(row.payload),
      });
      await sql`
        update notifications set status = 'sent', sent_at = ${now}, last_error = null, next_attempt_at = null
        where id = ${row.id}
      `.execute(db);
      outcome.sent++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (row.attempts >= MAX_ATTEMPTS) {
        await sql`update notifications set status = 'failed', last_error = ${error}, next_attempt_at = null where id = ${row.id}`.execute(
          db,
        );
        outcome.failed++;
        log?.error({ id: row.id, event: row.event, error }, 'notification failed for good');
      } else {
        await sql`
          update notifications
          set next_attempt_at = ${new Date(now.getTime() + retryDelayMs(row.attempts))}, last_error = ${error}
          where id = ${row.id}
        `.execute(db);
        outcome.retried++;
        log?.warn(
          { id: row.id, event: row.event, attempts: row.attempts, error },
          'notification will be retried',
        );
      }
    }
  }
  return outcome;
}
