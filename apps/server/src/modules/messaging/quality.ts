import { sql, type Kysely, type Transaction } from 'kysely';
import { decryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import type { MetaClient } from '../../lib/meta-client.js';
import { notify } from '../notifications/notify.js';

/** Meta's API value for what WhatsApp Manager shows as Low. Confirm in the real-number demo. */
export const LOW_QUALITY = 'RED';
export const LOW_QUALITY_REASON = 'Quality dropped to Low';

export interface PausableAccount {
  id: string;
  clientId: string;
  number: string;
}

/** Pauses an active account and tells everyone concerned. An account already paused changes nothing. */
export async function pauseAccountRow(
  trx: Transaction<Database>,
  account: PausableAccount,
  reason: string,
  now: Date,
): Promise<boolean> {
  const changed = await sql`
    update wa_accounts set status = 'paused', paused_reason = ${reason}
    where id = ${account.id} and status = 'active'
  `.execute(trx);
  if (Number(changed.numAffectedRows ?? 0) === 0) return false;
  await notify(
    trx,
    'account.paused',
    { clientId: account.clientId, entityId: `${account.id}:${now.toISOString()}` },
    { number: account.number, reason },
  );
  return true;
}

export interface LimitWebhook {
  display_phone_number?: string;
  current_limit?: string;
  max_daily_conversations_per_business?: string;
}

/**
 * Meta's quality webhook reports limit and throughput changes, not the quality rating, so the rating comes from
 * `syncQuality`. The limit belongs to the business portfolio, and is kept on each number for the account box.
 */
export async function applyLimitWebhook(
  trx: Transaction<Database>,
  wabaId: string | undefined,
  value: LimitWebhook,
) {
  const limit = value.max_daily_conversations_per_business ?? value.current_limit;
  if (!wabaId || !limit) return;
  await sql`update wa_accounts set messaging_limit = ${limit} where waba_id = ${wabaId}`.execute(trx);
}

interface HealthDeps {
  db: Kysely<Database>;
  meta: MetaClient;
  encryptionKey: string;
  log?: Logger;
}

/**
 * Reads each number's quality and limit. Dropping to Low pauses the account only on the change itself, so an
 * account the super admin resumed stays resumed; quality recovering never resumes it.
 */
export async function syncQuality({ db, meta, encryptionKey, log }: HealthDeps, now: Date = new Date()) {
  const accounts = (
    await sql<{
      id: string;
      client_id: string;
      display_phone: string;
      phone_number_id: string;
      access_token_enc: Buffer;
    }>`select id, client_id, display_phone, phone_number_id, access_token_enc from wa_accounts`.execute(db)
  ).rows;

  for (const account of accounts) {
    let token: string;
    try {
      token = decryptSecret(account.access_token_enc.toString('utf8'), encryptionKey);
    } catch {
      log?.error({ accountId: account.id }, 'token cannot be decrypted; quality not read');
      continue;
    }
    const health = await meta.phoneHealth(account.phone_number_id, token);
    if (!health.ok) {
      log?.warn({ accountId: account.id, code: health.code }, 'quality not read');
      continue;
    }
    const quality = health.data.quality_rating ?? null;
    const limit = health.data.whatsapp_business_manager_messaging_limit ?? null;
    await db.transaction().execute(async (trx) => {
      const before = (
        await sql<{ quality_rating: string | null }>`
          select quality_rating from wa_accounts where id = ${account.id} for update
        `.execute(trx)
      ).rows[0];
      await sql`
        update wa_accounts
        set quality_rating = coalesce(${quality}, quality_rating), messaging_limit = coalesce(${limit}, messaging_limit)
        where id = ${account.id}
      `.execute(trx);
      if (quality === LOW_QUALITY && before?.quality_rating !== LOW_QUALITY) {
        const paused = await pauseAccountRow(
          trx,
          { id: account.id, clientId: account.client_id, number: account.display_phone },
          LOW_QUALITY_REASON,
          now,
        );
        if (paused) log?.error({ accountId: account.id }, 'WhatsApp account paused: quality Low');
      }
    });
  }
}
