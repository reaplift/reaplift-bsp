import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { applyMessageStatusUpdate, type MessageUpdateState } from '../../lib/status-processor.js';

export const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;

interface StatusUpdate {
  id: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code?: number; title?: string }>;
  pricing?: { category?: string; billable?: boolean };
}

interface WebhookBody {
  entry?: Array<{ changes?: Array<{ field?: string; value?: { statuses?: StatusUpdate[] } }> }>;
}

interface EventRow {
  id: number;
  body: WebhookBody;
  received_at: Date;
}

function statusesIn(body: WebhookBody): StatusUpdate[] {
  return (body.entry ?? []).flatMap((entry) =>
    (entry.changes ?? [])
      .filter((change) => change.field === 'messages')
      .flatMap((change) => change.value?.statuses ?? []),
  );
}

export interface ProcessOutcome {
  processed: number;
  waiting: number;
  errored: number;
}

/**
 * Handles stored webhooks one at a time, each in its own transaction. Replies, template updates and account
 * updates are marked processed with no action; M5 and M7 add handlers, and the stored rows can be replayed.
 */
export async function processEvents(
  db: Kysely<Database>,
  now: Date = new Date(),
  log?: Logger,
): Promise<ProcessOutcome> {
  const outcome: ProcessOutcome = { processed: 0, waiting: 0, errored: 0 };
  let lastId = 0;

  for (let i = 0; i < BATCH_SIZE; i++) {
    let eventId = 0;
    try {
      await db.transaction().execute(async (trx) => {
        const event = (
          await sql<EventRow>`
            select id, body, received_at from meta_events
            where processed_at is null and id > ${lastId}
            order by id
            limit 1
            for update skip locked
          `.execute(trx)
        ).rows[0];
        if (!event) return;
        eventId = event.id;
        lastId = event.id;

        const orphans = await applyStatuses(trx, event);
        if (orphans === 0) {
          await sql`update meta_events set processed_at = ${now} where id = ${event.id}`.execute(trx);
          outcome.processed += 1;
        } else if (now.getTime() - event.received_at.getTime() >= ORPHAN_TIMEOUT_MS) {
          await sql`
            update meta_events set processed_at = ${now}, process_error = 'message not found'
            where id = ${event.id}
          `.execute(trx);
          log?.warn({ eventId: event.id }, 'webhook for an unknown message');
          outcome.errored += 1;
        } else {
          // The webhook beat the worker's save of the Meta message ID; try again on the next run.
          outcome.waiting += 1;
        }
      });
    } catch (err) {
      if (eventId === 0) throw err; // Reading the queue failed, not one event; the loop tries again.
      const message = err instanceof Error ? err.message : String(err);
      log?.error({ eventId, err: message }, 'webhook could not be processed');
      await sql`
        update meta_events set processed_at = ${now}, process_error = ${message} where id = ${eventId}
      `.execute(db);
      outcome.errored += 1;
    }
    if (eventId === 0) break;
  }
  return outcome;
}

/** Returns how many statuses are for a message not known yet. */
async function applyStatuses(trx: Transaction<Database>, event: EventRow): Promise<number> {
  let orphans = 0;
  for (const update of statusesIn(event.body)) {
    const current = (
      await sql<MessageUpdateState & { id: number }>`
        select id, status, sent_at, delivered_at, read_at, failed_at, failure_reason, meta_error_code
        from messages where meta_message_id = ${update.id}
        for update
      `.execute(trx)
    ).rows[0];
    if (!current) {
      orphans += 1;
      continue;
    }

    const metaTime = new Date(Number(update.timestamp) * 1000);
    if (Number.isNaN(metaTime.getTime())) throw new Error(`invalid timestamp "${update.timestamp}"`);

    const inserted = await sql`
      insert into message_status_events (meta_message_id, status, meta_timestamp, meta_event_id)
      values (${update.id}, ${update.status}, ${metaTime}, ${event.id})
      on conflict (meta_message_id, status) do nothing
    `.execute(trx);
    if (Number(inserted.numAffectedRows ?? 0) === 0) continue; // A repeat of a status already recorded.

    const error = update.errors?.[0];
    const next = applyMessageStatusUpdate(current, update.status, metaTime, {
      metaErrorCode: error?.code ?? null,
      title: error?.title ?? null,
    });
    await sql`
      update messages
      set status = ${next.status}, sent_at = ${next.sent_at ?? null},
        delivered_at = ${next.delivered_at ?? null}, read_at = ${next.read_at ?? null},
        failed_at = ${next.failed_at ?? null}, failure_reason = ${next.failure_reason ?? null},
        meta_error_code = ${next.meta_error_code ?? null},
        pricing_category = coalesce(${update.pricing?.category ?? null}, pricing_category),
        billable = coalesce(${update.pricing?.billable ?? null}, billable)
      where id = ${current.id}
    `.execute(trx);
  }
  return orphans;
}
