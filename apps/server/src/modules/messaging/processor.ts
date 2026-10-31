import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { applyMessageStatusUpdate, type MessageUpdateState } from '../../lib/status-processor.js';
import { applyReplies, type ReplyWebhook } from '../campaigns/opt-outs.js';
import { refundFailedMessage } from '../campaigns/refunds.js';
import { recordMetaCost } from '../reports/stats.js';
import { applyTemplateWebhook, type TemplateWebhook } from '../templates/status.js';
import { applyLimitWebhook, type LimitWebhook } from './quality.js';

export const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_SIZE = 100;
const DEADLOCK = '40P01';

interface StatusUpdate {
  id: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code?: number; title?: string }>;
  pricing?: { category?: string; billable?: boolean; type?: string };
  biz_opaque_callback_data?: string;
}

interface WebhookBody {
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: { statuses?: StatusUpdate[] } }>;
  }>;
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
 * Handles stored webhooks one at a time, each in its own transaction. Other events, such as replies, are marked
 * processed with no action; M7 adds a handler for those, and the stored rows can be replayed.
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

        const orphans = await applyStatuses(trx, event, now, log);
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
      if ((err as { code?: string }).code === DEADLOCK) {
        outcome.waiting += 1; // Nothing is wrong with the event; the next run takes it again.
        continue;
      }
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

/**
 * A status whose wamid we never saw may be from a send that timed out, which Meta did accept. Our message ID in the
 * callback data shows which message it was. If that message has no wamid and is still waiting, this is its send, so
 * it must not go out again. If it already has another wamid or has given up, this is a double send: it is counted by
 * `cli send-stats` and changes nothing here.
 */
async function recogniseByCallback(
  trx: Transaction<Database>,
  update: StatusUpdate,
  log?: Logger,
): Promise<(MessageUpdateState & { id: number }) | 'ignore' | 'unknown'> {
  const callback = update.biz_opaque_callback_data ?? '';
  if (!/^[1-9]\d{0,17}$/.test(callback)) return 'unknown';
  const message = (
    await sql<MessageUpdateState & { id: number; meta_message_id: string | null }>`
      select id, status, sent_at, delivered_at, read_at, failed_at, failure_reason, meta_error_code, meta_message_id
      from messages where id = ${callback}
      for update
    `.execute(trx)
  ).rows[0];
  if (!message) return 'unknown';
  if (message.meta_message_id || (message.status !== 'queued' && message.status !== 'sending')) {
    log?.warn({ messageId: message.id }, 'status for a second send of this message');
    return 'ignore';
  }
  await sql`update messages set meta_message_id = ${update.id} where id = ${message.id}`.execute(trx);
  return message;
}

/** Returns how many statuses are for a message not known yet. */
async function applyStatuses(trx: Transaction<Database>, event: EventRow, now: Date, log?: Logger): Promise<number> {
  for (const entry of event.body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'message_template_status_update') {
        await applyTemplateWebhook(trx, change.value as TemplateWebhook, now);
      } else if (change.field === 'phone_number_quality_update') {
        await applyLimitWebhook(trx, entry.id, change.value as LimitWebhook);
      } else if (change.field === 'messages') {
        await applyReplies(trx, change.value as ReplyWebhook);
      }
    }
  }

  let orphans = 0;
  for (const update of statusesIn(event.body)) {
    let current = (
      await sql<MessageUpdateState & { id: number }>`
        select id, status, sent_at, delivered_at, read_at, failed_at, failure_reason, meta_error_code
        from messages where meta_message_id = ${update.id}
        for update
      `.execute(trx)
    ).rows[0];
    if (!current) {
      const found = await recogniseByCallback(trx, update, log);
      if (found === 'ignore') continue;
      if (found === 'unknown') {
        orphans += 1;
        continue;
      }
      current = found;
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
        billable = coalesce(${update.pricing?.billable ?? null}, billable),
        pricing_type = coalesce(${update.pricing?.type ?? null}, pricing_type)
      where id = ${current.id}
    `.execute(trx);
    if (next.delivered_at && next.status !== 'failed') await recordMetaCost(trx, current.id, next.delivered_at, log);
    if (next.status === 'failed' && current.status !== 'failed') await refundFailedMessage(trx, current.id, now);
  }
  return orphans;
}
