import { sql, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import { applyLedgerEntry } from '../wallet/ledger.js';
import { chargePolicyFor } from '../wallet/pricing.js';

/** Refunds a failed campaign message, once, when the charging switch says failures are not charged. */
export async function refundFailedMessage(trx: Transaction<Database>, messageId: number, at: Date) {
  const message = (
    await sql<{ client_id: string; campaign_id: string | null; client_price_paise: number | null }>`
      select client_id, campaign_id, client_price_paise from messages where id = ${messageId}
    `.execute(trx)
  ).rows[0];
  if (!message?.campaign_id || !message.client_price_paise) return;
  const policy = await chargePolicyFor(trx, message.client_id);
  if (policy.failed) return;
  await applyLedgerEntry(trx, {
    clientId: message.client_id,
    kind: 'refund',
    amountPaise: message.client_price_paise,
    campaignId: message.campaign_id,
    messageId,
    note: 'Failed at Meta',
    at,
  });
}
