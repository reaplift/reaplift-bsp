import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { readPage } from '../../lib/pagination.js';
import { sendError } from '../auth/scope.js';
import { dailyRemaining, effectiveDailyLimit, estimateDelivery } from '../messaging/limits.js';
import { InsufficientBalanceError } from '../wallet/ledger.js';
import { CampaignRefused, computeSummary, type CampaignRow } from './campaign.js';
import { STALLED_AFTER_MS } from './monitor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_RATE_LIMIT_CODES = [4, 80007, 130429];

export interface Reason {
  code: string;
  message: string;
}

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** Why a campaign is where it is, in words a super admin can read to the client. */
export async function diagnoseCampaign(db: Kysely<Database>, campaign: CampaignRow, now: Date) {
  const facts = (
    await sql<{
      client_status: string;
      account_status: string;
      paused_reason: string | null;
      waba_id: string;
      daily_send_limit: number | null;
      messaging_limit: string | null;
      send_rate_per_sec: number;
    }>`
      select c.status as client_status, a.status as account_status, a.paused_reason, a.waba_id, a.daily_send_limit,
        a.messaging_limit, a.send_rate_per_sec
      from clients c join wa_accounts a on a.client_id = c.id
      where c.id = ${campaign.client_id} and a.id = ${campaign.wa_account_id}
    `.execute(db)
  ).rows[0]!;

  const counts = (
    await sql<{
      queued: number;
      sending: number;
      rate_limited: number;
      held: number;
      retrying: number;
      first_id: number | null;
      last_sent_at: Date | null;
    }>`
      select count(*) filter (where status = 'queued')::int as queued,
        count(*) filter (where status = 'sending')::int as sending,
        count(*) filter (where status = 'queued' and next_attempt_at > ${now} and meta_error_code = any(${META_RATE_LIMIT_CODES}::int[]))::int as rate_limited,
        count(*) filter (where status = 'queued' and next_attempt_at > ${now} and failure_reason = 'TimeoutError')::int as held,
        count(*) filter (where status = 'queued' and next_attempt_at > ${now})::int as retrying,
        min(id) filter (where status = 'queued') as first_id,
        max(sent_at) as last_sent_at
      from messages where campaign_id = ${campaign.id} and client_id = ${campaign.client_id}
    `.execute(db)
  ).rows[0]!;

  const ahead = counts.first_id
    ? (
        await sql<{ n: number }>`
          select count(*)::int as n from messages m
          left join campaigns k on k.id = m.campaign_id
          where m.wa_account_id = ${campaign.wa_account_id} and m.status = 'queued' and m.id < ${counts.first_id}
            and (m.campaign_id is null or k.status = 'running')
        `.execute(db)
      ).rows[0]!.n
    : 0;

  const limit = effectiveDailyLimit(facts.daily_send_limit, facts.messaging_limit);
  const remaining = await dailyRemaining(db, facts, now);
  const reasons: Reason[] = [];
  const add = (code: string, message: string) => reasons.push({ code, message });

  if (facts.client_status !== 'active') add('CLIENT_SUSPENDED', 'This client is suspended, so nothing can be sent.');
  if (facts.account_status !== 'active') {
    add('ACCOUNT_PAUSED', `The WhatsApp number is paused: ${facts.paused_reason ?? 'no reason given'}. A super admin must resume it.`);
  }

  if (campaign.status === 'draft' || campaign.status === 'scheduled') {
    // Runs the same checks as confirm, so this is exactly what the client would be told.
    try {
      const summary = await computeSummary(db, campaign, now);
      const held = (
        await sql<{ held: number }>`
          select coalesce(sum(amount_paise), 0)::bigint as held from wallet_holds
          where campaign_id = ${campaign.id} and client_id = ${campaign.client_id} and released_at is null
        `.execute(db)
      ).rows[0]!.held;
      const short = summary.chargePaise - held - summary.availablePaise;
      if (short > 0) {
        add('INSUFFICIENT_BALANCE', `Needs ${money(summary.chargePaise)}, and ${money(summary.availablePaise)} is available, so it is ${money(short)} short.`);
      }
      if (summary.willSend + summary.blocked.total === 0) add('LIST_EMPTY', 'The audience has no valid numbers.');
    } catch (err) {
      if (err instanceof CampaignRefused) {
        if (!reasons.some((r) => r.code === err.code)) add(err.code, `${err.message}.`);
      } else if (err instanceof InsufficientBalanceError) add('INSUFFICIENT_BALANCE', err.message);
      else throw err;
    }
    if (campaign.status === 'scheduled') {
      add('SCHEDULED', `Scheduled to start at ${campaign.scheduled_at?.toISOString()}; its money is on hold until then.`);
    }
  }

  if (campaign.status === 'paused') add('CAMPAIGN_PAUSED', 'Someone paused this campaign. Resume it to carry on sending.');

  if (campaign.status === 'running' && counts.queued > 0) {
    if (remaining === 0) {
      add('DAILY_LIMIT_REACHED', `The daily limit of ${limit} customers is used up. ${counts.queued} messages are waiting, and go out as the 24 hours move on.`);
    }
    if (ahead > 0) add('QUEUE_AHEAD', `${ahead} earlier messages on this number go first.`);
    if (counts.rate_limited > 0) add('META_RATE_LIMITED', `Meta asked us to slow down. ${counts.rate_limited} messages wait 30 seconds and try again; none will fail for this.`);
    if (counts.held > 0) add('WAITING_FOR_META_ANSWER', `Meta did not answer for ${counts.held} messages. They wait up to 5 minutes to see if Meta took them, so nobody gets a message twice.`);
    const other = counts.retrying - counts.rate_limited - counts.held;
    if (other > 0) add('RETRYING', `${other} messages hit a temporary error and will try again.`);

    const lastMove = (counts.last_sent_at ?? campaign.confirmed_at ?? now).getTime();
    if (reasons.length === 0 && now.getTime() - lastMove >= STALLED_AFTER_MS) {
      add('STALLED', 'No message has been sent for over 10 minutes, and no limit explains it. Check that the worker is running.');
    }
  }

  const failures = (
    await sql<{ code: number | null; reason: string | null; count: number }>`
      select meta_error_code as code, failure_reason as reason, count(*)::int as count
      from messages where campaign_id = ${campaign.id} and client_id = ${campaign.client_id} and status = 'failed'
      group by 1, 2 order by count desc limit 10
    `.execute(db)
  ).rows;

  return {
    status: campaign.status,
    headline: reasons[0]?.message ?? (campaign.status === 'running' ? 'Sending normally.' : `This campaign is ${campaign.status}.`),
    reasons,
    queue: { waiting: counts.queued, sending: counts.sending, aheadOnNumber: ahead },
    limits: {
      sendRatePerSec: facts.send_rate_per_sec,
      dailyLimit: limit,
      dailySetting: facts.daily_send_limit,
      metaLimit: facts.messaging_limit,
      remainingToday: remaining,
    },
    estimate: campaign.status === 'running' ? await estimateDelivery(db, campaign.wa_account_id, 0, now) : null,
    failures,
  };
}

export function registerCampaignDiagnosis(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  // Every client's campaigns, for finding the one a client is asking about.
  app.get('/api/admin/campaigns', async (req, reply) => {
    const { limit } = readPage(req.query);
    const { clientId, status } = req.query as { clientId?: string; status?: string };
    if (clientId && !UUID.test(clientId)) return sendError(reply, 400, 'INVALID_REQUEST', 'Bad filter');
    const rows = await sql`
      select k.id, k.client_id as "clientId", c.name as "clientName", k.name, k.status, k.total, k.sent, k.delivered, k.read,
        k.failed, k.blocked, k.scheduled_at as "scheduledAt", k.confirmed_at as "confirmedAt", k.created_at as "createdAt"
      from campaigns k join clients c on c.id = k.client_id
      where ${clientId ? sql`k.client_id = ${clientId}` : sql`true`} and ${status ? sql`k.status = ${status}` : sql`true`}
      order by k.created_at desc, k.id limit ${limit}
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.get('/api/admin/campaigns/:id/diagnosis', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const campaign = (await sql<CampaignRow>`select * from campaigns where id = ${id}`.execute(db)).rows[0];
    if (!campaign) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    return reply.code(200).send(await diagnoseCampaign(db, campaign, now()));
  });
}
