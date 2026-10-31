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

/** Money set aside for scheduled campaigns. */
export async function readOnHold(db: Kysely<Database>, clientId: string): Promise<number> {
  const row = (
    await sql<{ held: number }>`
      select coalesce(sum(amount_paise), 0)::bigint as held from wallet_holds
      where client_id = ${clientId} and released_at is null
    `.execute(db)
  ).rows[0]!;
  return row.held;
}

async function lockClient(trx: Transaction<Database>, clientId: string) {
  const client = (
    await sql<{ low_balance_alert_paise: number | null; name: string }>`
      select low_balance_alert_paise, name from clients where id = ${clientId} for update
    `.execute(trx)
  ).rows[0];
  if (!client) throw new Error(`no client ${clientId}`);
  return client;
}

/** The alert watches what the client can still spend, so setting money aside can trigger it too. */
async function alertIfCrossed(
  trx: Transaction<Database>,
  clientId: string,
  client: { low_balance_alert_paise: number | null; name: string },
  before: number,
  after: number,
  occurrence: string,
) {
  const alert = client.low_balance_alert_paise;
  if (alert === null || before < alert || after >= alert) return;
  await notify(
    trx,
    'wallet.low_balance',
    { clientId, entityId: `${clientId}:${occurrence}` },
    { name: client.name, balancePaise: after },
  );
}

/** Sets money aside for a scheduled campaign. Refused if that much is not available. */
export async function holdFunds(
  trx: Transaction<Database>,
  entry: { clientId: string; campaignId: string; amountPaise: number; createdBy: string; at: Date },
) {
  if (entry.amountPaise === 0) return;
  const client = await lockClient(trx, entry.clientId);
  const available = (await readBalance(trx, entry.clientId)) - (await readOnHold(trx, entry.clientId));
  const after = available - entry.amountPaise;
  if (after < 0) throw new InsufficientBalanceError(-after);
  await sql`
    insert into wallet_holds (client_id, campaign_id, amount_paise, created_by, created_at)
    values (${entry.clientId}, ${entry.campaignId}, ${entry.amountPaise}, ${entry.createdBy}, ${entry.at})
  `.execute(trx);
  await alertIfCrossed(trx, entry.clientId, client, available, after, `hold:${entry.campaignId}:${entry.at.toISOString()}`);
}

export async function releaseHold(
  trx: Transaction<Database>,
  clientId: string,
  campaignId: string,
  because: 'started' | 'unscheduled' | 'cancelled' | 'not_started',
  at: Date,
) {
  await sql`
    update wallet_holds set released_at = ${at}, released_because = ${because}
    where client_id = ${clientId} and campaign_id = ${campaignId} and released_at is null
  `.execute(trx);
}

/**
 * The only way to write the ledger. Locks the client's row first, so two changes at once cannot read the same
 * balance. Taking money is refused if it would dip into what is on hold or below zero. A second refund for one message
 * writes nothing and returns null. Crossing the client's alert level downward notifies once.
 */
export async function applyLedgerEntry(trx: Transaction<Database>, entry: LedgerEntry): Promise<{ id: number; balanceAfterPaise: number } | null> {
  const client = await lockClient(trx, entry.clientId);

  const before = await readBalance(trx, entry.clientId);
  const after = before + entry.amountPaise;
  const onHold = await readOnHold(trx, entry.clientId);
  if (entry.amountPaise < 0 && after - onHold < 0) throw new InsufficientBalanceError(onHold - after);

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

  await alertIfCrossed(trx, entry.clientId, client, before - onHold, after - onHold, String(inserted.id));
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

  // Each campaign: charges minus refunds equal what its messages were charged, less those refunded or cancelled.
  const campaigns = (
    await sql<{ id: string; client_id: string; name: string; net_paise: number; expected_paise: number }>`
      select k.id, k.client_id, k.name,
        coalesce((select -sum(l.amount_paise) from wallet_ledger l where l.client_id = k.client_id and l.campaign_id = k.id), 0)::bigint as net_paise,
        (coalesce(k.other_charged_paise, 0) + coalesce((
          select sum(m.client_price_paise) from messages m
          where m.campaign_id = k.id and m.block_reason is distinct from 'campaign_cancelled'
            and not exists (select 1 from wallet_ledger r where r.kind = 'refund' and r.message_id = m.id)
        ), 0))::bigint as expected_paise
      from campaigns k
      where k.confirmed_at is not null
    `.execute(db)
  ).rows.filter((k) => k.net_paise !== k.expected_paise);

  // Money can be on hold only for a campaign still waiting to start, and never more than the balance.
  const strayHolds = (
    await sql<{ id: string; client_id: string; name: string; net_paise: number; expected_paise: number }>`
      select k.id, k.client_id, k.name, h.amount_paise as net_paise, 0::bigint as expected_paise
      from wallet_holds h
      join campaigns k on k.id = h.campaign_id and k.client_id = h.client_id
      where h.released_at is null and k.status <> 'scheduled'
    `.execute(db)
  ).rows;
  campaigns.push(...strayHolds);
  const overHeld = (
    await sql<{ client_id: string; name: string; held: number; balance: number }>`
      select c.id as client_id, c.name, sum(h.amount_paise)::bigint as held,
        coalesce((select l.balance_after_paise from wallet_ledger l where l.client_id = c.id order by l.id desc limit 1), 0) as balance
      from wallet_holds h join clients c on c.id = h.client_id
      where h.released_at is null
      group by c.id, c.name
    `.execute(db)
  ).rows.filter((r) => r.held > r.balance);
  for (const row of overHeld) {
    bad.push({ client_id: row.client_id, name: row.name, sum_paise: row.held, balance_paise: row.balance, lowest_paise: 0 });
  }

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
    for (const campaign of campaigns) {
      await notify(
        trx,
        'wallet.reconciliation_mismatch',
        { clientId: campaign.client_id, entityId: `${campaign.id}:${day}` },
        { name: `${campaign.name} (campaign)`, sumPaise: campaign.net_paise, balancePaise: campaign.expected_paise },
      );
    }
  });
  if (bad.length > 0 || campaigns.length > 0) {
    log?.error({ clients: bad.map((r) => r.client_id), campaigns: campaigns.map((k) => k.id) }, 'ledger check found a mismatch');
  } else log?.info({ clients: rows.length }, 'ledger check clean');
  return [...bad.map((r) => r.client_id), ...campaigns.map((k) => k.id)];
}
