import { sql, type Kysely, type Transaction } from 'kysely';
import { decryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { classifyMetaError, type MetaClient } from '../../lib/meta-client.js';
import { pauseAccountRow } from '../messaging/quality.js';
import { rejectSubmission } from './status.js';

const BATCH_SIZE = 20;
export const SUBMIT_RETRY_MS = 60 * 1000;

interface Due {
  id: string;
  client_id: string;
  wa_account_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  components: unknown[];
  status: string;
  submitted_by: string | null;
  waba_id: string;
  display_phone: string;
  access_token_enc: Buffer;
}

interface SubmitDeps {
  db: Kysely<Database>;
  meta: MetaClient;
  encryptionKey: string;
  log?: Logger;
}

/**
 * Sends `SUBMITTING` templates to Meta, one transaction each, so two workers never send the same one. A temporary
 * error waits and tries again: `updated_at` is moved ahead to the next try. A rejected template Meta already knows
 * is edited there, because its name is taken at Meta.
 */
export async function submitDue(deps: SubmitDeps, now: Date = new Date()): Promise<number> {
  let handled = 0;
  for (let i = 0; i < BATCH_SIZE; i++) {
    const found = await deps.db.transaction().execute((trx) => submitOne(trx, deps, now));
    if (!found) break;
    handled += 1;
  }
  return handled;
}

async function submitOne(trx: Transaction<Database>, { meta, encryptionKey, log }: SubmitDeps, now: Date) {
  const row = (
    await sql<Due>`
      select t.id, t.client_id, t.wa_account_id, t.meta_template_id, t.name, t.language, t.category, t.components,
        t.status, t.submitted_by, a.waba_id, a.display_phone, a.access_token_enc
      from templates t
      join wa_accounts a on a.id = t.wa_account_id and a.client_id = t.client_id
      where t.status = 'SUBMITTING' and t.updated_at <= ${now} and a.status = 'active'
      order by t.updated_at
      limit 1
      for update of t skip locked
    `.execute(trx)
  ).rows[0];
  if (!row) return false;

  const tryLater = () =>
    sql`
      update templates set updated_at = ${new Date(now.getTime() + SUBMIT_RETRY_MS)}
      where id = ${row.id} and client_id = ${row.client_id}
    `.execute(trx);

  const account = { id: row.wa_account_id, clientId: row.client_id, number: row.display_phone };
  let token: string;
  try {
    token = decryptSecret(row.access_token_enc.toString('utf8'), encryptionKey);
  } catch {
    await pauseAccountRow(trx, account, 'token cannot be decrypted', now);
    return true;
  }

  const result = row.meta_template_id
    ? await meta.editTemplate(row.meta_template_id, token, { category: row.category, components: row.components })
    : await meta.createTemplate(row.waba_id, token, {
        name: row.name,
        language: row.language,
        category: row.category,
        components: row.components,
      });

  if (result.ok) {
    const id = (result.data as { id?: string }).id ?? row.meta_template_id;
    await sql`
      update templates set status = 'PENDING', meta_template_id = ${id ?? null}, updated_at = ${now}
      where id = ${row.id} and client_id = ${row.client_id}
    `.execute(trx);
    return true;
  }

  const category = classifyMetaError(result.code).category;
  if (category === 'account') {
    await pauseAccountRow(trx, account, `Meta error ${result.code}: ${result.title}`, now);
  } else if (category === 'permanent') {
    await rejectSubmission(trx, row, result.title, now);
    log?.warn({ templateId: row.id, code: result.code }, 'Meta refused a template');
  } else {
    await tryLater();
    log?.warn({ templateId: row.id, code: result.code }, 'template submission will be retried');
  }
  return true;
}
