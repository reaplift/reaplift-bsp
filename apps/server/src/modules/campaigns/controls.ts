import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { CampaignSchedule, RuleUpdate } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import type { Logger } from '../../lib/logger.js';
import { writeAudit } from '../admin/audit.js';
import { sendError, type Scope } from '../auth/scope.js';
import { notify } from '../notifications/notify.js';
import { applyLedgerEntry, holdFunds, InsufficientBalanceError, releaseHold } from '../wallet/ledger.js';
import { CampaignRefused, computeSummary, confirmCampaign, type CampaignRow } from './campaign.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MIN_SCHEDULE_AHEAD_MS = 5 * 60 * 1000;

const lockCampaign = async (trx: Transaction<Database>, clientId: string, id: string) =>
  (await sql<CampaignRow>`select * from campaigns where id = ${id} and client_id = ${clientId} for update`.execute(trx)).rows[0];

class Stop extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Starts campaigns that are due, each in its own transaction. A short balance or other problem returns it to draft. */
export async function startDueCampaigns(db: Kysely<Database>, now: Date = new Date(), log?: Logger) {
  const due = (
    await sql<CampaignRow>`
      select * from campaigns where status = 'scheduled' and scheduled_at <= ${now} order by scheduled_at
    `.execute(db)
  ).rows;

  for (const campaign of due) {
    const scope = { clientId: campaign.client_id, userId: campaign.created_by, entityId: `${campaign.id}:${now.toISOString()}` };
    try {
      await db.transaction().execute(async (trx) => {
        await confirmCampaign(trx, campaign.client_id, campaign.id, campaign.created_by, now, ['scheduled']);
        await notify(trx, 'campaign.scheduled_started', scope, { name: campaign.name });
      });
    } catch (err) {
      let reason: string;
      if (err instanceof InsufficientBalanceError) reason = `the wallet is short by ₹${(err.shortPaise / 100).toFixed(2)}`;
      else if (err instanceof CampaignRefused) {
        if (err.code === 'ALREADY_CONFIRMED') continue; // Another scheduler took it.
        reason = err.message;
      } else throw err;
      await db.transaction().execute(async (trx) => {
        const back = await sql`
          update campaigns set status = 'draft', scheduled_at = null, updated_at = ${now}
          where id = ${campaign.id} and client_id = ${campaign.client_id} and status = 'scheduled'
        `.execute(trx);
        if (Number(back.numAffectedRows ?? 0) > 0) {
          await releaseHold(trx, campaign.client_id, campaign.id, 'not_started', now);
          await notify(trx, 'campaign.scheduled_not_started', scope, { name: campaign.name, reason });
        }
      });
      log?.warn({ campaignId: campaign.id, reason }, 'scheduled campaign did not start');
    }
  }
}

export function registerCampaignControls(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  const stopped = (reply: FastifyReply, err: unknown) => {
    if (err instanceof Stop) return sendError(reply, err.status, err.code, err.message);
    if (err instanceof CampaignRefused) return reply.code(err.status).send({ error: err.code, message: err.message });
    throw err;
  };

  const audit = (trx: Transaction<Database>, scope: Scope, id: string, action: string, extra: { after?: unknown; before?: unknown }) =>
    writeAudit(trx, {
      clientId: scope.clientId,
      userId: scope.userId,
      action,
      entityType: 'campaign',
      entityId: id,
      ...extra,
      at: now(),
    });

  const whoIs = async (trx: Transaction<Database>, userId: string) =>
    (await sql<{ name: string }>`select name from users where id = ${userId}`.execute(trx)).rows[0]!.name;

  for (const [path, from, to, event] of [
    ['pause', 'running', 'paused', 'campaign.paused'],
    ['resume', 'paused', 'running', 'campaign.resumed'],
  ] as const) {
    app.post(`/api/clients/:clientId/campaigns/:id/${path}`, async (req, reply) => {
      const scope = req.scope!;
      const { id } = req.params as { id: string };
      if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
      try {
        await db.transaction().execute(async (trx) => {
          const campaign = await lockCampaign(trx, scope.clientId, id);
          if (!campaign) throw new Stop(404, 'NOT_FOUND', 'Not found');
          if (campaign.status !== from) throw new Stop(409, 'WRONG_STATUS', `This campaign is ${campaign.status}`);
          await sql`
            update campaigns set status = ${to}, updated_at = ${now()} where id = ${id} and client_id = ${scope.clientId}
          `.execute(trx);
          const auditId = await audit(trx, scope, id, event, { before: { status: from }, after: { status: to } });
          await notify(
            trx,
            event,
            { clientId: scope.clientId, userId: campaign.created_by, entityId: `${id}:${auditId}` },
            { name: campaign.name, by: await whoIs(trx, scope.userId) },
          );
        });
        return reply.code(200).send({ status: to });
      } catch (err) {
        return stopped(reply, err);
      }
    });
  }

  app.post('/api/clients/:clientId/campaigns/:id/cancel', async (req, reply) => {
    const scope = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const at = now();
    try {
      const result = await db.transaction().execute(async (trx) => {
        const campaign = await lockCampaign(trx, scope.clientId, id);
        if (!campaign) throw new Stop(404, 'NOT_FOUND', 'Not found');
        if (campaign.status === 'cancelled') throw new Stop(409, 'ALREADY_CANCELLED', 'This campaign is already cancelled');
        if (!['running', 'paused', 'scheduled'].includes(campaign.status)) {
          throw new Stop(409, 'WRONG_STATUS', `This campaign is ${campaign.status}`);
        }
        await sql`
          update campaigns set status = 'cancelled', cancelled_at = ${at}, cancelled_by = ${scope.userId}, updated_at = ${at}
          where id = ${id} and client_id = ${scope.clientId}
        `.execute(trx);

        await releaseHold(trx, scope.clientId, id, 'cancelled', at);

        // A row the worker claimed a moment ago is already `sending`, so it is skipped and its result decides its charge.
        const cancelled = (
          await sql<{ cancelled: number; refund: number }>`
            with changed as (
              update messages set status = 'blocked', block_reason = 'campaign_cancelled'
              where campaign_id = ${id} and client_id = ${scope.clientId} and status = 'queued'
              returning client_price_paise
            )
            select count(*)::int as cancelled, coalesce(sum(client_price_paise), 0)::bigint as refund from changed
          `.execute(trx)
        ).rows[0]!;

        if (cancelled.refund > 0) {
          await applyLedgerEntry(trx, {
            clientId: scope.clientId,
            kind: 'refund',
            amountPaise: cancelled.refund,
            campaignId: id,
            note: `${cancelled.cancelled} messages cancelled`,
            createdBy: scope.userId,
            at,
          });
        }
        const auditId = await audit(trx, scope, id, 'campaign.cancelled', {
          before: { status: campaign.status },
          after: { cancelled: cancelled.cancelled, refundPaise: cancelled.refund },
        });
        await notify(
          trx,
          'campaign.cancelled',
          { clientId: scope.clientId, userId: campaign.created_by, entityId: `${id}:${auditId}` },
          { name: campaign.name, cancelled: cancelled.cancelled, refundPaise: cancelled.refund },
        );
        return { status: 'cancelled', cancelled: cancelled.cancelled, refundPaise: cancelled.refund };
      });
      return reply.code(200).send(result);
    } catch (err) {
      return stopped(reply, err);
    }
  });

  app.post('/api/clients/:clientId/campaigns/:id/schedule', async (req, reply) => {
    const scope = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const parsed = CampaignSchedule.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send the time to start');
    const at = new Date(parsed.data.at);
    const current = now();
    if (at.getTime() < current.getTime() + MIN_SCHEDULE_AHEAD_MS) {
      return sendError(reply, 400, 'TOO_SOON', 'Schedule at least 5 minutes ahead');
    }
    let heldPaise = 0;
    try {
      await db.transaction().execute(async (trx) => {
        const campaign = await lockCampaign(trx, scope.clientId, id);
        if (!campaign) throw new Stop(404, 'NOT_FOUND', 'Not found');
        if (campaign.status !== 'draft') throw new Stop(409, 'WRONG_STATUS', `This campaign is ${campaign.status}`);
        // A campaign that could not start now is refused now. Its money is set aside, so nothing else can spend it.
        const summary = await computeSummary(trx, campaign, current);
        if (summary.willSend + summary.blocked.total === 0) {
          throw new CampaignRefused(400, 'LIST_EMPTY', 'This audience has no valid numbers');
        }
        heldPaise = summary.chargePaise;
        await holdFunds(trx, { clientId: scope.clientId, campaignId: id, amountPaise: heldPaise, createdBy: scope.userId, at: current });
        await sql`
          update campaigns set status = 'scheduled', scheduled_at = ${at}, updated_at = ${current}
          where id = ${id} and client_id = ${scope.clientId}
        `.execute(trx);
        await audit(trx, scope, id, 'campaign.scheduled', { after: { scheduledAt: at.toISOString(), heldPaise } });
      });
      return reply.code(200).send({ status: 'scheduled', scheduledAt: at.toISOString(), heldPaise });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return reply.code(402).send({ error: 'INSUFFICIENT_BALANCE', message: 'Top up needed', shortPaise: err.shortPaise });
      }
      return stopped(reply, err);
    }
  });

  app.post('/api/clients/:clientId/campaigns/:id/unschedule', async (req, reply) => {
    const scope = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    try {
      await db.transaction().execute(async (trx) => {
        const campaign = await lockCampaign(trx, scope.clientId, id);
        if (!campaign) throw new Stop(404, 'NOT_FOUND', 'Not found');
        if (campaign.status !== 'scheduled') throw new Stop(409, 'WRONG_STATUS', `This campaign is ${campaign.status}`);
        await sql`
          update campaigns set status = 'draft', scheduled_at = null, updated_at = ${now()}
          where id = ${id} and client_id = ${scope.clientId}
        `.execute(trx);
        await releaseHold(trx, scope.clientId, id, 'unscheduled', now());
        await audit(trx, scope, id, 'campaign.unscheduled', {});
      });
      return reply.code(200).send({ status: 'draft' });
    } catch (err) {
      return stopped(reply, err);
    }
  });

  app.get('/api/admin/rules', async (_req, reply) => {
    const rows = await sql`
      select id, client_id as "clientId", type, values, enabled, updated_at as "updatedAt"
      from rules order by client_id nulls first, type
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.put('/api/admin/rules', async (req, reply) => {
    const parsed = RuleUpdate.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Check the rule', details: parsed.error.flatten() });
    }
    const { clientId, type, values, enabled } = parsed.data;
    if (clientId && !(await sql`select 1 from clients where id = ${clientId}`.execute(db)).rows[0]) {
      return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    }
    const at = now();
    const json = JSON.stringify(values);
    await db.transaction().execute(async (trx) => {
      const before = (
        await sql<{ values: unknown; enabled: boolean }>`
          select values, enabled from rules where type = ${type} and client_id is not distinct from ${clientId}
        `.execute(trx)
      ).rows[0];
      if (clientId) {
        await sql`
          insert into rules (client_id, type, values, enabled, updated_by, updated_at)
          values (${clientId}, ${type}, ${json}::jsonb, ${enabled}, ${req.auth!.userId}, ${at})
          on conflict (client_id, type) where client_id is not null
          do update set values = excluded.values, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `.execute(trx);
      } else {
        await sql`
          insert into rules (client_id, type, values, enabled, updated_by, updated_at)
          values (null, ${type}, ${json}::jsonb, ${enabled}, ${req.auth!.userId}, ${at})
          on conflict (type) where client_id is null
          do update set values = excluded.values, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        `.execute(trx);
      }
      await writeAudit(trx, {
        clientId,
        userId: req.auth!.userId,
        action: 'rule.changed',
        entityType: 'rule',
        entityId: type,
        before: before ?? null,
        after: { values, enabled },
        at,
      });
    });
    return reply.code(200).send(parsed.data);
  });
}
