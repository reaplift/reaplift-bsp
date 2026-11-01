import { sql, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';

export interface AuditEntry {
  clientId?: string | null;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
  at: Date;
}

/** One row per admin change, in the change's own transaction. Never pass a password or a hash. Returns the row's ID. */
export async function writeAudit(trx: Transaction<Database>, entry: AuditEntry): Promise<number> {
  const details = {
    ...(entry.before === undefined ? {} : { before: entry.before }),
    ...(entry.after === undefined ? {} : { after: entry.after }),
    ...(entry.note === undefined ? {} : { note: entry.note }),
  };
  const row = await sql<{ id: number }>`
    insert into audit_logs (client_id, user_id, action, entity_type, entity_id, details, created_at)
    values (
      ${entry.clientId ?? null}, ${entry.userId}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
      ${JSON.stringify(details)}::jsonb, ${entry.at}
    )
    returning id
  `.execute(trx);
  return row.rows[0]!.id;
}
