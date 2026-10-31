import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import { dailyRemaining } from '../messaging/limits.js';
import { notify } from '../notifications/notify.js';

/** D4: a campaign that has stopped moving, not one that is merely large. */
export const STALLED_AFTER_MS = 10 * 60 * 1000;
const HIGH_FAILURE_MIN_RESULTS = 200;
const HIGH_FAILURE_PERCENT = 10;

interface Running {
  id: string;
  client_id: string;
  name: string;
  created_by: string;
  total: number;
  blocked: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  account_status: string;
  account_reason: string | null;
  waba_id: string;
  daily_send_limit: number | null;
  messaging_limit: string | null;
  confirmed_at: Date;
  waiting: number;
  queued: number;
  last_sent_at: Date | null;
}

/** Completes finished campaigns and raises each campaign's alerts. Each alert fires once: `notify` ignores a repeat. */
export async function watchCampaigns(db: Kysely<Database>, now: Date = new Date()) {
  const running = (
    await sql<Running>`
      select k.id, k.client_id, k.name, k.created_by, k.total, k.blocked, k.sent, k.delivered, k.read, k.failed, k.confirmed_at,
        a.status as account_status, a.paused_reason as account_reason, a.waba_id, a.daily_send_limit, a.messaging_limit,
        (select count(*)::int from messages m where m.campaign_id = k.id and m.status in ('queued', 'sending')) as waiting,
        (select count(*)::int from messages m where m.campaign_id = k.id and m.status = 'queued') as queued,
        (select max(m.sent_at) from messages m where m.campaign_id = k.id and m.status <> 'queued') as last_sent_at
      from campaigns k
      join wa_accounts a on a.id = k.wa_account_id and a.client_id = k.client_id
      where k.status = 'running'
    `.execute(db)
  ).rows;

  for (const campaign of running) {
    const atDailyLimit = campaign.queued > 0 && (await dailyRemaining(db, campaign, now)) === 0;
    await db.transaction().execute(async (trx) => {
      const scope = { clientId: campaign.client_id, userId: campaign.created_by, entityId: campaign.id };
      const totals = { name: campaign.name, sent: campaign.sent + campaign.delivered + campaign.read, failed: campaign.failed, blocked: campaign.blocked };
      if (campaign.waiting === 0) {
        const done = await sql`
          update campaigns set status = 'completed', updated_at = ${now}
          where id = ${campaign.id} and client_id = ${campaign.client_id} and status = 'running'
        `.execute(trx);
        if (Number(done.numAffectedRows ?? 0) > 0) await notify(trx, 'campaign.completed', scope, totals);
      }

      if (campaign.account_status !== 'active') {
        await notify(trx, 'campaign.account_paused', scope, { name: campaign.name, reason: campaign.account_reason });
      } else if (atDailyLimit) {
        // Waiting on purpose, so this is not a stall. Told once a day.
        await notify(
          trx,
          'campaign.daily_limit_reached',
          { ...scope, entityId: `${campaign.id}:${now.toISOString().slice(0, 10)}` },
          { name: campaign.name, queued: campaign.queued },
        );
      } else if (
        campaign.queued > 0 &&
        now.getTime() - (campaign.last_sent_at ?? campaign.confirmed_at).getTime() >= STALLED_AFTER_MS
      ) {
        await notify(trx, 'campaign.stalled', scope, { name: campaign.name, queued: campaign.queued });
      }

      const results = campaign.sent + campaign.delivered + campaign.read + campaign.failed;
      if (results >= HIGH_FAILURE_MIN_RESULTS && (campaign.failed * 100) / results > HIGH_FAILURE_PERCENT) {
        await notify(trx, 'campaign.high_failure', scope, { name: campaign.name, failed: campaign.failed, results });
      }
    });
  }
}
