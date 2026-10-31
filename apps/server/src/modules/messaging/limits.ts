import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The worker's rounds took it to about 91% of its setting: 20,000 at 50 a second took 438 s, not 400. */
const ESTIMATE_SPEED_FACTOR = 0.9;

const META_TIER_PER_DAY: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_2K: 2000,
  TIER_10K: 10000,
  TIER_100K: 100000,
};

/** The tighter of the super admin's setting and Meta's limit. Null when neither sets one. */
export function effectiveDailyLimit(setting: number | null, metaTier: string | null): number | null {
  const meta = META_TIER_PER_DAY[metaTier ?? ''] ?? null;
  if (setting === null) return meta;
  return meta === null ? setting : Math.min(setting, meta);
}

/**
 * How many more customers can be messaged now. Meta counts unique numbers in a moving 24 hours across the business, so
 * this counts them across every number on the WhatsApp account. A batch may repeat a number already counted, which
 * only makes this a little cautious. Null means no limit.
 */
export async function dailyRemaining(
  db: Kysely<Database>,
  account: { waba_id: string; daily_send_limit: number | null; messaging_limit: string | null },
  now: Date,
): Promise<number | null> {
  const limit = effectiveDailyLimit(account.daily_send_limit, account.messaging_limit);
  if (limit === null) return null;
  const since = new Date(now.getTime() - DAY_MS);
  const row = (
    await sql<{ used: number }>`
      select count(distinct m.to_number)::int as used
      from messages m
      join wa_accounts a on a.id = m.wa_account_id
      where a.waba_id = ${account.waba_id}
        and ((m.sent_at >= ${since} and m.status in ('sent', 'delivered', 'read')) or m.status = 'sending')
    `.execute(db)
  ).rows[0]!;
  return Math.max(limit - row.used, 0);
}

/**
 * Each number's limits and what it has used, for the super admin. Numbers on one WhatsApp account share a daily count,
 * as Meta counts them together, so the overall figure counts each account once.
 */
export async function readLimitUsage(db: Kysely<Database>, now: Date) {
  const since = new Date(now.getTime() - DAY_MS);
  const lastMinute = new Date(now.getTime() - 60_000);
  const numbers = (
    await sql<{
      id: string;
      client_id: string;
      client_name: string;
      display_phone: string;
      waba_id: string;
      status: string;
      send_rate_per_sec: number;
      daily_send_limit: number | null;
      messaging_limit: string | null;
      waiting: number;
      sent_last_minute: number;
    }>`
      select a.id, a.client_id, c.name as client_name, a.display_phone, a.waba_id, a.status, a.send_rate_per_sec,
        a.daily_send_limit, a.messaging_limit,
        (select count(*)::int from messages m where m.wa_account_id = a.id and m.status in ('queued', 'sending')) as waiting,
        (select count(*)::int from messages m where m.wa_account_id = a.id and m.sent_at >= ${lastMinute}) as sent_last_minute
      from wa_accounts a join clients c on c.id = a.client_id
      order by c.name, a.created_at
    `.execute(db)
  ).rows;
  const used = new Map(
    (
      await sql<{ waba_id: string; used: number }>`
        select a.waba_id, count(distinct m.to_number)::int as used
        from messages m join wa_accounts a on a.id = m.wa_account_id
        where (m.sent_at >= ${since} and m.status in ('sent', 'delivered', 'read')) or m.status = 'sending'
        group by a.waba_id
      `.execute(db)
    ).rows.map((r) => [r.waba_id, r.used]),
  );

  const items = numbers.map((n) => {
    const limit = effectiveDailyLimit(n.daily_send_limit, n.messaging_limit);
    const usedToday = used.get(n.waba_id) ?? 0;
    return {
      waAccountId: n.id,
      clientId: n.client_id,
      clientName: n.client_name,
      displayPhone: n.display_phone,
      wabaId: n.waba_id,
      status: n.status,
      sendRatePerSec: n.send_rate_per_sec,
      sentPerSecLastMinute: Math.round((n.sent_last_minute / 60) * 10) / 10,
      dailySendLimit: n.daily_send_limit,
      metaLimit: n.messaging_limit,
      effectiveDailyLimit: limit,
      usedLast24Hours: usedToday,
      remaining: limit === null ? null : Math.max(limit - usedToday, 0),
      usedPercent: limit === null ? null : Math.floor((usedToday * 100) / limit),
      waiting: n.waiting,
    };
  });

  const accounts = [...new Map(items.map((i) => [i.wabaId, i])).values()];
  return {
    items,
    overall: {
      numbers: items.length,
      pausedNumbers: items.filter((i) => i.status !== 'active').length,
      usedLast24Hours: accounts.reduce((sum, a) => sum + a.usedLast24Hours, 0),
      waiting: items.reduce((sum, i) => sum + i.waiting, 0),
      sentPerSecLastMinute: Math.round(items.reduce((sum, i) => sum + i.sentPerSecLastMinute, 0) * 10) / 10,
      numbersAtDailyLimit: items.filter((i) => i.remaining === 0).length,
    },
  };
}

export interface DeliveryEstimate {
  /** Messages already waiting on this number, which go first. */
  messagesAhead: number;
  seconds: number;
  finishesAt: string;
  waitsForDailyLimit: boolean;
}

/**
 * When `count` more messages should have gone to Meta, from the number's speed, its daily limit and what is ahead of
 * them. It is when they are sent, not when phones receive them, and assumes Meta does not ask us to slow down.
 */
export async function estimateDelivery(
  db: Kysely<Database>,
  accountId: string,
  count: number,
  at: Date,
): Promise<DeliveryEstimate> {
  const account = (
    await sql<{ waba_id: string; daily_send_limit: number | null; messaging_limit: string | null; send_rate_per_sec: number }>`
      select waba_id, daily_send_limit, messaging_limit, send_rate_per_sec from wa_accounts where id = ${accountId}
    `.execute(db)
  ).rows[0]!;
  const messagesAhead = (
    await sql<{ n: number }>`
      select count(*)::int as n from messages m
      left join campaigns k on k.id = m.campaign_id
      where m.wa_account_id = ${accountId} and m.status in ('queued', 'sending')
        and (m.campaign_id is null or k.status = 'running')
    `.execute(db)
  ).rows[0]!.n;

  const total = messagesAhead + count;
  const sendingSeconds = Math.ceil(total / (account.send_rate_per_sec * ESTIMATE_SPEED_FACTOR));
  const remaining = await dailyRemaining(db, account, at);
  const limit = effectiveDailyLimit(account.daily_send_limit, account.messaging_limit);
  const waitsForDailyLimit = remaining !== null && total > remaining;
  // Each full day's limit beyond what is left today adds a day of waiting.
  const waitingDays = waitsForDailyLimit ? Math.ceil((total - remaining) / limit!) : 0;
  const seconds = sendingSeconds + (waitingDays * DAY_MS) / 1000;
  return {
    messagesAhead,
    seconds,
    finishesAt: new Date(at.getTime() + seconds * 1000).toISOString(),
    waitsForDailyLimit,
  };
}
