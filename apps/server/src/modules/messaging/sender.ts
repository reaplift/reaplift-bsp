import { sql, type Kysely } from 'kysely';
import { decryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import {
  buildTemplateMessagePayload,
  classifyMetaError,
  extractMetaMessageId,
  type MetaClient,
  type MetaFailure,
} from '../../lib/meta-client.js';
import { calculateNextAttemptAt } from '../../lib/worker.js';

export const MAX_SEND_ATTEMPTS = 5;
export const STUCK_AFTER_MS = 5 * 60 * 1000;

const ACCOUNT_REASONS: Record<number, string> = {
  190: 'token invalid',
  131031: 'account restricted by Meta',
  131042: 'payment problem',
};
const CREDIT_LINE_PAYERS = new Set(['partner_credit_line', 'reaplift_credit_line']);

interface ActiveAccount {
  id: string;
  phone_number_id: string;
  access_token_enc: Buffer;
  send_rate_per_sec: number;
  meta_payer: string;
}

interface ClaimedMessage {
  id: number;
  to_number: string;
  variables: string[];
  attempts: number;
  template_name: string;
  template_language: string;
}

/**
 * Keeps each account within `send_rate_per_sec`. It counts one process's sends, so run one worker per
 * environment until a shared limit is needed; a second worker is safe for correctness but doubles the rate.
 */
export class AccountPacer {
  private readonly nextAllowedAt = new Map<string, number>();

  isReady(accountId: string, now: number): boolean {
    return (this.nextAllowedAt.get(accountId) ?? 0) <= now;
  }

  record(accountId: string, sent: number, ratePerSec: number, now: number) {
    this.nextAllowedAt.set(accountId, now + (sent / ratePerSec) * 1000);
  }
}

export interface SenderDeps {
  db: Kysely<Database>;
  meta: MetaClient;
  encryptionKey: string;
  pacer: AccountPacer;
  log?: Logger;
}

export interface SendOutcome {
  sent: number;
  retried: number;
  failed: number;
  paused: number;
}

/** Claims and sends what is due on each active account. A paused account's messages are never claimed. */
export async function sendDue(deps: SenderDeps, now: Date = new Date()): Promise<SendOutcome> {
  const { db, pacer } = deps;
  const outcome: SendOutcome = { sent: 0, retried: 0, failed: 0, paused: 0 };

  const accounts = (
    await sql<ActiveAccount>`
      select a.id, a.phone_number_id, a.access_token_enc, a.send_rate_per_sec, a.meta_payer
      from wa_accounts a
      where a.status = 'active' and exists (
        select 1 from messages m
        where m.wa_account_id = a.id and m.status = 'queued' and m.next_attempt_at <= ${now}
      )
    `.execute(db)
  ).rows;

  await Promise.all(
    accounts
      .filter((account) => pacer.isReady(account.id, Date.now()))
      .map(async (account) => {
        const claimed = await claim(db, account, now);
        if (claimed.length > 0) {
          pacer.record(account.id, claimed.length, account.send_rate_per_sec, Date.now());
        }
        await sendBatch(deps, account, claimed, now, outcome);
      }),
  );
  return outcome;
}

/** Moves rows to `sending` in one statement with `for update skip locked`, so two workers never take the same row. */
async function claim(
  db: Kysely<Database>,
  account: ActiveAccount,
  now: Date,
): Promise<ClaimedMessage[]> {
  return (
    await sql<ClaimedMessage>`
      update messages m
      set status = 'sending', locked_at = ${now}, attempts = m.attempts + 1
      from templates t
      where t.id = m.template_id and m.id in (
        select id from messages
        where wa_account_id = ${account.id} and status = 'queued' and next_attempt_at <= ${now}
        order by id
        limit ${account.send_rate_per_sec}
        for update skip locked
      )
      returning m.id, m.to_number, m.variables, m.attempts,
        t.name as template_name, t.language as template_language
    `.execute(db)
  ).rows;
}

async function sendBatch(
  deps: SenderDeps,
  account: ActiveAccount,
  claimed: ClaimedMessage[],
  now: Date,
  outcome: SendOutcome,
) {
  if (claimed.length === 0) return;

  let token: string;
  try {
    token = decryptSecret(account.access_token_enc.toString('utf8'), deps.encryptionKey);
  } catch {
    await pauseAccount(deps, account, 'token cannot be decrypted', claimed, now);
    outcome.paused += 1;
    return;
  }

  let paused = false;
  await Promise.all(
    claimed.map(async (message) => {
      const result = await deps.meta.sendMessage(
        account.phone_number_id,
        token,
        buildTemplateMessagePayload({
          to: message.to_number,
          templateName: message.template_name,
          language: message.template_language,
          variables: message.variables,
        }),
      );

      if (!result.ok) {
        const handled = await handleFailure(deps, account, message, result, now);
        if (handled === 'paused') paused = true;
        else outcome[handled] += 1;
        return;
      }

      const metaMessageId = extractMetaMessageId(result.data);
      if (!metaMessageId) {
        await markFailed(deps.db, message.id, 'Meta accepted the message without an ID', null, now);
        outcome.failed += 1;
        return;
      }
      await sql`
        update messages
        set status = 'sent', meta_message_id = ${metaMessageId}, sent_at = ${now},
          failure_reason = null, meta_error_code = null
        where id = ${message.id} and status = 'sending'
      `.execute(deps.db);
      outcome.sent += 1;
    }),
  );
  if (paused) outcome.paused += 1;
}

async function handleFailure(
  deps: SenderDeps,
  account: ActiveAccount,
  message: ClaimedMessage,
  failure: MetaFailure,
  now: Date,
): Promise<'retried' | 'failed' | 'paused'> {
  const { db, log } = deps;
  const classified = classifyMetaError(failure.code);
  const code = failure.code ?? null;

  if (classified.category === 'account') {
    const reason = (failure.code && ACCOUNT_REASONS[failure.code]) || `Meta error ${failure.code}: ${failure.title}`;
    await pauseAccount(deps, account, reason, [message], now, code);
    if (failure.code === 131042 && CREDIT_LINE_PAYERS.has(account.meta_payer)) {
      // Every client on the shared credit line may be about to fail. M11 task 11.1 turns this log into an alert.
      log?.error({ accountId: account.id, alert: 'credit-line' }, 'payment error on a credit line account');
    }
    return 'paused';
  }

  if (classified.category === 'permanent' || message.attempts >= MAX_SEND_ATTEMPTS) {
    await markFailed(db, message.id, failure.title, code, now);
    log?.warn({ messageId: message.id, code }, 'message failed');
    return 'failed';
  }

  await sql`
    update messages
    set status = 'queued', next_attempt_at = ${calculateNextAttemptAt(message.attempts, now)},
      failure_reason = ${failure.title}, meta_error_code = ${code}
    where id = ${message.id} and status = 'sending'
  `.execute(db);
  log?.warn({ messageId: message.id, code, attempts: message.attempts }, 'message will be retried');
  return 'retried';
}

function markFailed(
  db: Kysely<Database>,
  id: number,
  reason: string,
  code: number | null,
  now: Date,
) {
  return sql`
    update messages
    set status = 'failed', failed_at = ${now}, failure_reason = ${reason}, meta_error_code = ${code}
    where id = ${id} and status = 'sending'
  `.execute(db);
}

/** Pauses the account and returns the rows to the queue without using up an attempt: the message was not at fault. */
async function pauseAccount(
  { db, log }: SenderDeps,
  account: ActiveAccount,
  reason: string,
  messages: ClaimedMessage[],
  now: Date,
  code: number | null = null,
) {
  await db.transaction().execute(async (trx) => {
    await sql`
      update wa_accounts set status = 'paused', paused_reason = ${reason}
      where id = ${account.id} and status = 'active'
    `.execute(trx);
    for (const message of messages) {
      await sql`
        update messages
        set status = 'queued', attempts = attempts - 1, next_attempt_at = ${now}, locked_at = null,
          failure_reason = ${reason}, meta_error_code = ${code}
        where id = ${message.id} and status = 'sending'
      `.execute(trx);
    }
  });
  log?.error({ accountId: account.id, reason, code }, 'WhatsApp account paused');
}

/**
 * Logs rows left in `sending` by a crash. They are never sent again automatically: Meta may already have
 * accepted them, and sending twice would charge the customer twice.
 */
export async function reportStuck(
  db: Kysely<Database>,
  log?: Logger,
  now: Date = new Date(),
): Promise<number[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const ids = (
    await sql<{ id: number }>`
      select id from messages where status = 'sending' and locked_at < ${cutoff} order by id
    `.execute(db)
  ).rows.map((row) => row.id);
  if (ids.length > 0) log?.warn({ messageIds: ids }, 'messages stuck in sending; not resending');
  return ids;
}
