import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { notify } from '../notifications/notify.js';

export const TIME_ZONE = 'Asia/Kolkata';
/** Long enough for a message's last status to arrive; older days do not change. */
const REFRESH_DAYS = 40;
const CREDIT_ALERTS = [95, 80];
export const CREDIT_LIMIT_KEY = 'credit_limit_paise';

const FREE_TYPE = /^free/i;
/** Written into the query, so the same expression in `select` and `group by` matches. */
const ZONE = sql.lit(TIME_ZONE);

/**
 * What Meta bills for a delivered message, once. It uses Meta's own category and the rate valid at delivery. `billable`
 * is deprecated, so a message counts as free if either it or the pricing type says so (question 5 in open-questions.md).
 */
export async function recordMetaCost(trx: Transaction<Database>, messageId: number, deliveredAt: Date) {
  const message = (
    await sql<{ pricing_category: string | null; pricing_type: string | null; billable: boolean | null; template_category: string; country: string | null; cost: number | null }>`
      select m.pricing_category, m.pricing_type, m.billable, t.category as template_category,
        c.country_calling_code as country, m.meta_cost_centipaise as cost
      from messages m
      join templates t on t.id = m.template_id
      join clients c on c.id = m.client_id
      where m.id = ${messageId}
    `.execute(trx)
  ).rows[0];
  if (!message || message.cost !== null || !message.country) return;

  if (message.billable === false || FREE_TYPE.test(message.pricing_type ?? '')) {
    await sql`update messages set meta_cost_centipaise = 0, meta_cost_paise = 0 where id = ${messageId}`.execute(trx);
    return;
  }
  const category = (message.pricing_category ?? message.template_category).toUpperCase();
  const rate = (
    await sql<{ rate_centipaise: number }>`
      select rate_centipaise from meta_rates
      where category = ${category} and country_calling_code = ${message.country} and valid_from <= ${deliveredAt}
      order by valid_from desc, seq desc limit 1
    `.execute(trx)
  ).rows[0];
  if (!rate) return;
  await sql`
    update messages set meta_cost_centipaise = ${rate.rate_centipaise}, meta_cost_paise = round(${rate.rate_centipaise}::numeric / 100)
    where id = ${messageId}
  `.execute(trx);
}

/**
 * Rebuilds recent days from `messages`, so a repeat always gives the same figures. A message counts on the day it was
 * queued, in India time, in its latest status. The charge is what it was charged, less a refund or a cancellation.
 */
export async function refreshDailyStats(db: Kysely<Database>, now: Date = new Date(), allDays = false) {
  const from = allDays ? null : new Date(now.getTime() - REFRESH_DAYS * 24 * 60 * 60 * 1000);
  await db.transaction().execute(async (trx) => {
    await sql`
      delete from daily_stats
      where ${from ? sql`date >= (${from}::timestamptz at time zone ${ZONE})::date` : sql`true`}
    `.execute(trx);
    await sql`
      insert into daily_stats (client_id, date, category, queued, sent, delivered, read, failed, blocked, client_charge_paise, meta_cost_centipaise)
      select m.client_id, (m.queued_at at time zone ${ZONE})::date, t.category,
        count(*) filter (where m.status in ('queued', 'sending')),
        count(*) filter (where m.status = 'sent'),
        count(*) filter (where m.status = 'delivered'),
        count(*) filter (where m.status = 'read'),
        count(*) filter (where m.status = 'failed'),
        count(*) filter (where m.status = 'blocked'),
        coalesce(sum(m.client_price_paise) filter (
          where m.block_reason is distinct from 'campaign_cancelled'
            and not exists (select 1 from wallet_ledger r where r.kind = 'refund' and r.message_id = m.id)
        ), 0),
        coalesce(sum(m.meta_cost_centipaise), 0)
      from messages m
      join templates t on t.id = m.template_id
      where ${from ? sql`(m.queued_at at time zone ${ZONE})::date >= (${from}::timestamptz at time zone ${ZONE})::date` : sql`true`}
      group by m.client_id, (m.queued_at at time zone ${ZONE})::date, t.category
    `.execute(trx);
  });
}

/** This month's Meta cost, by delivery date in India time, in hundredths of a paisa. */
export async function monthMetaCost(db: Kysely<Database>, month: string): Promise<number> {
  const row = (
    await sql<{ cost: number }>`
      select coalesce(sum(meta_cost_centipaise), 0)::bigint as cost from messages
      where to_char(delivered_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
    `.execute(db)
  ).rows[0]!;
  return row.cost;
}

export const monthOf = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit' }).format(at).slice(0, 7);

/** One credit line pays for every client, so if it runs out, every client stops. Alerts at 80% and 95%, once a month each. */
export async function checkCreditLine(db: Kysely<Database>, now: Date = new Date(), log?: Logger) {
  const setting = (
    await sql<{ value: number }>`select value from settings where key = ${CREDIT_LIMIT_KEY}`.execute(db)
  ).rows[0];
  if (!setting) return;
  const month = monthOf(now);
  const usedPaise = (await monthMetaCost(db, month)) / 100;
  const percent = (usedPaise * 100) / setting.value;
  const level = CREDIT_ALERTS.find((alert) => percent >= alert);
  if (!level) return;
  await db.transaction().execute((trx) =>
    notify(trx, 'billing.credit_line_usage', { entityId: `${month}:${level}` }, { month, percent: Math.floor(percent), level }),
  );
  log?.warn({ month, percent }, 'credit line usage is high');
}
