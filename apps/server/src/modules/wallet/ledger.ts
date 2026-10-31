import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { notify } from '../notifications/notify.js';

export type LedgerKind = 'topup' | 'adjustment' | 'charge' | 'refund';

export interface LedgerEntry {
  clientId: string;
  kind: LedgerKind;
  /** Positive adds, negative takes. */
  amountPaise: number;
  campaignId?: string | null;
  messageId?: number | null;
  note?: string | null;
  createdBy?: string | null;
  at: Date;
}

export class InsufficientBalanceError extends Error {
  constructor(readonly shortPaise: number) {
    super(`balance is short by ${shortPaise} paise`);
  }
}

/** The latest row's balance. Read under the client's lock when the answer decides a change. */
export async function readBalance(db: Kysely<Database>, clientId: string): Promise<number> {
  const row = (
    await sql<{ balance_after_paise: number }>`
      select balance_after_paise from wallet_ledger where client_id = ${clientId} order by id desc limit 1
    `.execute(db)
  ).rows[0];
  return row?.balance_after_paise ?? 0;
}

/**
 * The only way to write the ledger. Locks the client's row first, so two changes at once cannot read the same
 * balance; a change that would make the balance negative is refused. A second refund for one message writes nothing
 * and returns null. Crossing the client's alert level downward notifies once.
 */
export async function applyLedgerEntry(trx: Transaction<Database>, entry: LedgerEntry): Promise<{ id: number; balanceAfterPaise: number } | null> {
  const client = (
    await sql<{ low_balance_alert_paise: number | null; name: string }>`
      select low_balance_alert_paise, name from clients where id = ${entry.clientId} for update
    `.execute(trx)
  ).rows[0];
  if (!client) throw new Error(`no client ${entry.clientId}`);

  const before = await readBalance(trx, entry.clientId);
  const after = before + entry.amountPaise;
  if (after < 0) throw new InsufficientBalanceError(-after);

  const inserted = (
    await sql<{ id: number }>`
      insert into wallet_ledger (client_id, kind, amount_paise, balance_after_paise, campaign_id, message_id, note, created_by, created_at)
      values (
        ${entry.clientId}, ${entry.kind}, ${entry.amountPaise}, ${after}, ${entry.campaignId ?? null},
        ${entry.messageId ?? null}, ${entry.note ?? null}, ${entry.createdBy ?? null}, ${entry.at}
      )
      on conflict (message_id) where kind = 'refund' do nothing
      returning id
    `.execute(trx)
  ).rows[0];
  if (!inserted) return null;

  const alert = client.low_balance_alert_paise;
  if (alert !== null && before >= alert && after < alert) {
    await notify(
      trx,
      'wallet.low_balance',
      { clientId: entry.clientId, entityId: `${entry.clientId}:${inserted.id}` },
      { name: client.name, balancePaise: after },
    );
  }
  return { id: inserted.id, balanceAfterPaise: after };
}

/** For every client: the ledger adds up to the latest balance, and no balance is negative. */
export async function checkLedgers(db: Kysely<Database>, now: Date = new Date(), log?: Logger) {
  const rows = (
    await sql<{ client_id: string; name: string; sum_paise: number; balance_paise: number; lowest_paise: number }>`
      select l.client_id, c.name, sum(l.amount_paise)::bigint as sum_paise,
        (array_agg(l.balance_after_paise order by l.id desc))[1] as balance_paise,
        min(l.balance_after_paise) as lowest_paise
      from wallet_ledger l
      join clients c on c.id = l.client_id
      group by l.client_id, c.name
    `.execute(db)
  ).rows;
  const bad = rows.filter((r) => r.sum_paise !== r.balance_paise || r.lowest_paise < 0);

  const day = now.toISOString().slice(0, 10);
  await db.transaction().execute(async (trx) => {
    for (const row of bad) {
      await notify(
        trx,
        'wallet.reconciliation_mismatch',
        { clientId: row.client_id, entityId: `${row.client_id}:${day}` },
        { name: row.name, sumPaise: row.sum_paise, balancePaise: row.balance_paise },
      );
    }
  });
  if (bad.length > 0) log?.error({ clients: bad.map((r) => r.client_id) }, 'ledger check found a mismatch');
  else log?.info({ clients: rows.length }, 'ledger check clean');
  return bad.map((r) => r.client_id);
}
