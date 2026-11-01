import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';

export interface ReplyWebhook {
  metadata?: { phone_number_id?: string };
  messages?: Array<{ from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }>;
}

/**
 * A customer's reply that is a stop word opts them out of the client that owns the number they wrote to, and no other.
 * Only an exact match counts, so "please do not stop" is not an opt-out.
 */
export async function applyReplies(trx: Transaction<Database>, value: ReplyWebhook) {
  if (!value.messages?.length || !value.metadata?.phone_number_id) return;
  const account = (
    await sql<{ client_id: string }>`
      select client_id from wa_accounts where phone_number_id = ${value.metadata.phone_number_id}
    `.execute(trx)
  ).rows[0];
  if (!account) return;
  const words = new Set(await readWords(trx, 'stop_words'));
  for (const message of value.messages) {
    const text = (message.text?.body ?? message.button?.text ?? '').trim().toUpperCase();
    if (!message.from || !words.has(text)) continue;
    await sql`
      insert into opt_outs (client_id, number, source) values (${account.client_id}, ${message.from}, 'stop_reply')
      on conflict (client_id, number) do nothing
    `.execute(trx);
  }
}

export async function readWords(db: Kysely<Database>, key: string): Promise<string[]> {
  const row = (await sql<{ value: string[] }>`select value from settings where key = ${key}`.execute(db)).rows[0];
  return (row?.value ?? []).map((word) => word.toUpperCase());
}
