import { sql, type Kysely, type Transaction } from 'kysely';
import type { VariableMap } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { notify } from '../notifications/notify.js';
import { applyLedgerEntry, readBalance, readOnHold, releaseHold } from '../wallet/ledger.js';
import { chargePolicyFor, priceAt } from '../wallet/pricing.js';
import { effectiveDailyLimit, estimateDelivery, type DeliveryEstimate } from '../messaging/limits.js';
import { marketingCap, repeatWithinHours } from './rules.js';

export interface CampaignRow {
  id: string;
  client_id: string;
  name: string;
  template_id: string;
  wa_account_id: string;
  list_id: string | null;
  variable_map: VariableMap;
  status: string;
  created_by: string;
  scheduled_at?: Date | null;
  confirmed_at?: Date | null;
}

export interface RowBlock {
  row: number;
  reason: string;
}

/** One check: one SQL query over the campaign's contacts returning (row, reason). M8's rules plug in here. */
export type RowCheck = (db: Kysely<Database>, campaign: CampaignRow, at: Date) => Promise<RowBlock[]>;

const optedOut: RowCheck = async (db, campaign) =>
  (
    await sql<RowBlock>`
      select lc.row_number as row, 'opted_out' as reason
      from list_contacts lc
      join opt_outs o on o.client_id = lc.client_id and o.number = lc.number
      where lc.list_id = ${campaign.list_id} and lc.client_id = ${campaign.client_id}
    `.execute(db)
  ).rows;

export const ROW_CHECKS: RowCheck[] = [optedOut, repeatWithinHours, marketingCap];

/** Refused with these codes, on 400 or 409, before any money moves. */
export class CampaignRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface Facts {
  templateStatus: string;
  templateCategory: string;
  variableCount: number;
  accountStatus: string;
  accountReason: string | null;
  messagingLimit: string | null;
  dailySendLimit: number | null;
  clientStatus: string;
  numberColumn: number | null;
  columnCount: number;
}

async function readFacts(db: Kysely<Database>, campaign: CampaignRow): Promise<Facts> {
  return (
    await sql<Facts>`
      select t.status as "templateStatus", t.category as "templateCategory", t.variable_count as "variableCount",
        a.status as "accountStatus", a.paused_reason as "accountReason", a.messaging_limit as "messagingLimit", a.daily_send_limit as "dailySendLimit",
        c.status as "clientStatus", l.number_column as "numberColumn",
        coalesce(jsonb_array_length(l.columns), 0) as "columnCount"
      from campaigns k
      join templates t on t.id = k.template_id and t.client_id = k.client_id
      join wa_accounts a on a.id = k.wa_account_id and a.client_id = k.client_id
      join clients c on c.id = k.client_id
      left join lists l on l.id = k.list_id and l.client_id = k.client_id
      where k.id = ${campaign.id} and k.client_id = ${campaign.client_id}
    `.execute(db)
  ).rows[0]!;
}

/** The problems a campaign must not start with. Throws the first one. */
function refuseIfNotReady(campaign: CampaignRow, facts: Facts) {
  if (!campaign.list_id) throw new CampaignRefused(400, 'LIST_NOT_READY', 'Upload an audience first');
  if (facts.numberColumn === null) throw new CampaignRefused(400, 'LIST_NOT_READY', 'Choose the number column first');
  if (facts.templateStatus !== 'APPROVED') {
    throw new CampaignRefused(400, 'TEMPLATE_NOT_APPROVED', `The template is ${facts.templateStatus}`);
  }
  for (let i = 1; i <= facts.variableCount; i++) {
    const source = campaign.variable_map[String(i)];
    if (!source) throw new CampaignRefused(400, 'VARIABLE_NOT_MAPPED', `Fill in variable ${i}`);
    if ('column' in source && source.column >= facts.columnCount) {
      throw new CampaignRefused(400, 'COLUMN_OUT_OF_RANGE', `Variable ${i} points to a column that is not in the list`);
    }
  }
  if (facts.clientStatus !== 'active') throw new CampaignRefused(409, 'CLIENT_SUSPENDED', 'This client is suspended');
  if (facts.accountStatus !== 'active') {
    throw new CampaignRefused(409, 'ACCOUNT_PAUSED', `The WhatsApp number is paused: ${facts.accountReason ?? 'no reason given'}`);
  }
}

export interface Summary {
  total: number;
  willSend: number;
  blocked: { total: number; byReason: Record<string, number> };
  invalid: { total: number; byReason: Record<string, number> };
  duplicate: number;
  pricePaise: number;
  chargePaise: number;
  /** What the client can spend: its balance, less money on hold for scheduled campaigns. */
  availablePaise: number;
  balancePaise: number;
  balanceAfterPaise: number;
  limitWarning: { limit: number } | null;
  estimate: DeliveryEstimate;
}

interface Computed extends Summary {
  blocks: RowBlock[];
  /** What a queued and a blocked message are each charged. */
  sendPricePaise: number;
  blockedPricePaise: number;
}

/** Runs every check. It is computed on request and stored nowhere, because confirm runs it again. */
export async function computeSummary(db: Kysely<Database>, campaign: CampaignRow, at: Date): Promise<Computed> {
  const facts = await readFacts(db, campaign);
  refuseIfNotReady(campaign, facts);

  const price = await priceAt(db, campaign.client_id, facts.templateCategory, at);
  if (price === null) throw new CampaignRefused(409, 'NO_PRICE', 'This message type has no price yet. Please contact ReapLift.');

  const counts = (
    await sql<{ reason: string | null; duplicates: number; count: number }>`
      select invalid_reason as reason, (duplicate_of_row is not null)::int as duplicates, count(*)::int as count
      from list_contacts
      where list_id = ${campaign.list_id} and client_id = ${campaign.client_id}
      group by invalid_reason, duplicate_of_row is not null
    `.execute(db)
  ).rows;

  const invalid: Record<string, number> = {};
  let invalidTotal = 0;
  let duplicate = 0;
  let eligible = 0;
  for (const row of counts) {
    if (row.duplicates === 1) duplicate += row.count;
    else if (row.reason) {
      invalid[row.reason] = row.count;
      invalidTotal += row.count;
    } else eligible += row.count;
  }

  // Earlier checks win, so one number has one reason.
  const reasons = new Map<number, string>();
  for (const check of ROW_CHECKS) {
    for (const block of await check(db, campaign, at)) {
      if (!reasons.has(block.row)) reasons.set(block.row, block.reason);
    }
  }
  const blocks = [...reasons].map(([row, reason]) => ({ row, reason }));
  const byReason: Record<string, number> = {};
  for (const { reason } of blocks) byReason[reason] = (byReason[reason] ?? 0) + 1;

  const willSend = eligible - blocks.length;
  const policy = await chargePolicyFor(db, campaign.client_id);
  const sendPricePaise = policy.delivered ? price : 0;
  const blockedPricePaise = policy.blocked ? price : 0;
  const chargePaise =
    willSend * sendPricePaise +
    blocks.length * blockedPricePaise +
    (policy.invalid ? invalidTotal * price : 0) +
    (policy.duplicate ? duplicate * price : 0);
  const balancePaise = await readBalance(db, campaign.client_id);
  const availablePaise = balancePaise - (await readOnHold(db, campaign.client_id));
  const limit = effectiveDailyLimit(facts.dailySendLimit, facts.messagingLimit);

  return {
    total: eligible + invalidTotal + duplicate,
    willSend,
    blocked: { total: blocks.length, byReason },
    invalid: { total: invalidTotal, byReason: invalid },
    duplicate,
    pricePaise: price,
    chargePaise,
    availablePaise,
    balancePaise,
    balanceAfterPaise: availablePaise - chargePaise,
    limitWarning: limit !== null && willSend > limit ? { limit } : null,
    estimate: await estimateDelivery(db, campaign.wa_account_id, willSend, at),
    blocks,
    sendPricePaise,
    blockedPricePaise,
  };
}

export function publicSummary(computed: Computed): Summary {
  const summary: Partial<Computed> = { ...computed };
  delete summary.blocks;
  delete summary.sendPricePaise;
  delete summary.blockedPricePaise;
  return summary as Summary;
}

/**
 * Charges and queues in one transaction. Runs every check again under the campaign's lock, so an opt-out added after
 * the summary is caught, and a second confirm charges nothing. Throws InsufficientBalanceError with nothing written.
 */
export async function confirmCampaign(
  trx: Transaction<Database>,
  clientId: string,
  campaignId: string,
  userId: string,
  at: Date,
  allowedFrom: readonly string[] = ['draft'],
): Promise<Summary> {
  const campaign = (
    await sql<CampaignRow>`
      select * from campaigns where id = ${campaignId} and client_id = ${clientId} for update
    `.execute(trx)
  ).rows[0];
  if (!campaign) throw new CampaignRefused(404, 'NOT_FOUND', 'Not found');
  if (!allowedFrom.includes(campaign.status)) {
    throw new CampaignRefused(409, 'ALREADY_CONFIRMED', `This campaign is ${campaign.status}`);
  }

  // Its hold becomes the charge below; the money is free for that moment only inside this transaction.
  if (campaign.status === 'scheduled') await releaseHold(trx, clientId, campaignId, 'started', at);

  const summary = await computeSummary(trx, campaign, at);
  if (summary.willSend + summary.blocked.total === 0) {
    throw new CampaignRefused(400, 'LIST_EMPTY', 'This audience has no valid numbers');
  }

  if (summary.chargePaise > 0) {
    await applyLedgerEntry(trx, {
      clientId,
      kind: 'charge',
      amountPaise: -summary.chargePaise,
      campaignId,
      note: `Campaign: ${campaign.name}`,
      createdBy: userId,
      at,
    });
  }

  const variables = Object.keys(campaign.variable_map)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const source = campaign.variable_map[key]!;
      return 'text' in source ? sql`${source.text}::text` : sql`coalesce(lc.cells->>${source.column}::int, '')`;
    });
  const variablesSql = variables.length > 0 ? sql`jsonb_build_array(${sql.join(variables)})` : sql`'[]'::jsonb`;
  const blockRows = summary.blocks.map((b) => b.row);
  const blockReasons = summary.blocks.map((b) => b.reason);

  await sql`
    insert into messages (
      client_id, wa_account_id, campaign_id, template_id, to_number, variables, status, block_reason,
      client_price_paise, source, next_attempt_at, queued_at
    )
    select
      lc.client_id, ${campaign.wa_account_id}::uuid, ${campaignId}::uuid, ${campaign.template_id}::uuid, lc.number, ${variablesSql},
      case when b.reason is null then 'queued' else 'blocked' end, b.reason,
      case when b.reason is null then ${summary.sendPricePaise}::bigint else ${summary.blockedPricePaise}::bigint end,
      'panel', ${at}, ${at}
    from list_contacts lc
    left join unnest(${blockRows}::int[], ${blockReasons}::text[]) as b(row_number, reason) on b.row_number = lc.row_number
    where lc.list_id = ${campaign.list_id} and lc.client_id = ${clientId}
      and lc.number is not null and lc.invalid_reason is null and lc.duplicate_of_row is null
    order by lc.row_number
  `.execute(trx);

  const nothingToSend = summary.willSend === 0;
  await sql`
    update campaigns
    set status = ${nothingToSend ? 'completed' : 'running'}, confirmed_by = ${userId}, confirmed_at = ${at}, updated_at = ${at},
      total = ${summary.willSend + summary.blocked.total}, blocked = ${summary.blocked.total},
      sent = 0, delivered = 0, read = 0, failed = 0,
      other_charged_paise = ${summary.chargePaise - summary.willSend * summary.sendPricePaise - summary.blocked.total * summary.blockedPricePaise}
    where id = ${campaignId} and client_id = ${clientId}
  `.execute(trx);

  await notify(
    trx,
    'campaign.started',
    { clientId, userId: campaign.created_by, entityId: campaignId },
    { name: campaign.name, willSend: summary.willSend },
  );
  return publicSummary(summary);
}
