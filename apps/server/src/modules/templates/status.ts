import { sql, type Kysely, type Transaction } from 'kysely';
import { decryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import type { MetaClient } from '../../lib/meta-client.js';
import { syncTemplates } from '../messaging/account.js';
import { notify } from '../notifications/notify.js';

/** Plain explanations of every reason on Meta's template status webhook page, checked 31 October 2026. */
export const REJECTION_HELP: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta found content it considers abusive. Reword the template.',
  CATEGORY_NOT_AVAILABLE: 'This category is not available for the template. Pick another category.',
  INCORRECT_CATEGORY: 'The content does not match the chosen category. Pick the category that fits.',
  INVALID_FORMAT: 'The template format is not valid. Follow Meta’s recommendation shown here.',
  NONE: 'Meta gave no reason.',
  PROMOTIONAL: 'The content is promotional, so it cannot use this category. Change the category to MARKETING.',
  SCAM: 'Meta considers this content a possible scam. Reword it.',
  TAG_CONTENT_MISMATCH: 'The content does not match the template’s category or tag. Change one so they fit.',
};

export const explainRejection = (reason: string | null) =>
  reason === null ? null : (REJECTION_HELP[reason] ?? reason);

/** Webhook events that change what the template can do. FLAGGED and LIMIT_EXCEEDED are warnings and change nothing. */
const STATUS_FROM_EVENT: Record<string, string> = {
  APPROVED: 'APPROVED',
  REINSTATED: 'APPROVED',
  UNARCHIVED: 'APPROVED',
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED',
  PENDING_DELETION: 'PENDING_DELETION',
  IN_APPEAL: 'IN_APPEAL',
  LOCKED: 'LOCKED',
};

interface StatusChange {
  status: string;
  reason?: string | null;
  recommendation?: string | null;
}

interface TemplateRow {
  id: string;
  client_id: string;
  name: string;
  status: string;
  submitted_by: string | null;
}

/** Moves a locked template to a status and notifies, only if the status really changed; a repeat does nothing. */
async function applyChange(trx: Transaction<Database>, row: TemplateRow, change: StatusChange, now: Date) {
  if (row.status === change.status) return;
  await sql`
    update templates
    set status = ${change.status},
      rejection_reason = ${change.status === 'REJECTED' ? (change.reason ?? null) : null},
      meta_recommendation = ${change.status === 'REJECTED' ? (change.recommendation ?? null) : null},
      updated_at = ${now}
    where id = ${row.id} and client_id = ${row.client_id}
  `.execute(trx);

  const entityId = `${row.id}:${change.status}:${now.toISOString()}`;
  if (change.status === 'APPROVED') {
    await notify(trx, 'template.approved', { clientId: row.client_id, userId: row.submitted_by, entityId }, { name: row.name });
  } else if (change.status === 'REJECTED') {
    const reason = explainRejection(change.reason ?? 'NONE');
    await notify(trx, 'template.rejected', { clientId: row.client_id, userId: row.submitted_by, entityId }, { name: row.name, reason });
  } else if (change.status === 'PAUSED' || change.status === 'DISABLED') {
    await notify(trx, 'template.paused_or_disabled', { clientId: row.client_id, entityId }, { name: row.name, status: change.status });
  }
}

export interface TemplateWebhook {
  event?: string;
  message_template_id?: string | number;
  reason?: string | null;
  rejection_info?: { reason?: string; recommendation?: string };
}

export async function applyTemplateWebhook(trx: Transaction<Database>, value: TemplateWebhook, now: Date) {
  const status = STATUS_FROM_EVENT[value.event ?? ''];
  if (!status || value.message_template_id === undefined) return;
  const row = (
    await sql<TemplateRow>`
      select id, client_id, name, status, submitted_by from templates
      where meta_template_id = ${String(value.message_template_id)}
      for update
    `.execute(trx)
  ).rows[0];
  // A webhook that beats the worker's save of the ID is caught by the next status sync.
  if (!row || row.status === 'DRAFT' || row.status === 'VALIDATION_FAILED' || row.status === 'SUBMITTING') return;
  await applyChange(trx, row, {
    status,
    reason: value.reason ?? null,
    recommendation: value.rejection_info?.recommendation ?? null,
  }, now);
}

/** Saves a rejection found while submitting, in the submitter's transaction. */
export function rejectSubmission(trx: Transaction<Database>, row: TemplateRow, reason: string, now: Date) {
  return applyChange(trx, row, { status: 'REJECTED', reason }, now);
}

interface SyncDeps {
  db: Kysely<Database>;
  meta: MetaClient;
  encryptionKey: string;
  log?: Logger;
}

/** Catches any status change a webhook missed, and copies in templates made directly at Meta. */
export async function syncTemplateStatuses({ db, meta, encryptionKey, log }: SyncDeps, now: Date = new Date()) {
  const accounts = (
    await sql<{ id: string; client_id: string; waba_id: string; access_token_enc: Buffer }>`
      select id, client_id, waba_id, access_token_enc from wa_accounts where status = 'active'
    `.execute(db)
  ).rows;

  for (const account of accounts) {
    try {
      const token = decryptSecret(account.access_token_enc.toString('utf8'), encryptionKey);
      const listed = await meta.listTemplates(account.waba_id, token);
      if (!listed.ok) {
        log?.warn({ accountId: account.id, code: listed.code }, 'templates not synced');
        continue;
      }
      for (const template of listed.data) {
        await db.transaction().execute(async (trx) => {
          const row = (
            await sql<TemplateRow & { meta_template_id: string | null }>`
              select id, client_id, name, status, submitted_by, meta_template_id from templates
              where wa_account_id = ${account.id} and client_id = ${account.client_id}
                and name = ${template.name} and language = ${template.language}
              for update
            `.execute(trx)
          ).rows[0];
          if (!row || row.status === 'DRAFT' || row.status === 'VALIDATION_FAILED') return;
          // An edit on its way to Meta: Meta still reports the old status until the worker has sent it.
          if (row.status === 'SUBMITTING' && row.meta_template_id) return;
          await applyChange(trx, row, { status: template.status, reason: template.rejected_reason ?? null }, now);
        });
      }
      await syncTemplates(db, meta, { id: account.id, clientId: account.client_id, wabaId: account.waba_id }, token);
    } catch (err) {
      log?.error({ accountId: account.id, err }, 'templates not synced');
    }
  }
}
