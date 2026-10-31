import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { Adjustment, ChargePolicyUpdate, ClientPricing, DefaultPricing, LowBalanceAlert, MetaRateCreate, TopUp } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { readPage, toPage } from '../../lib/pagination.js';
import { writeAudit } from '../admin/audit.js';
import { sendError } from '../auth/scope.js';
import { notify } from '../notifications/notify.js';
import { applyLedgerEntry, InsufficientBalanceError, readBalance, readOnHold, type LedgerKind } from './ledger.js';
import { CATEGORIES, chargePolicyFor, priceAt, recomputePrices } from './pricing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['topup', 'adjustment', 'charge', 'refund']);
const notFound = (reply: FastifyReply) => sendError(reply, 404, 'NOT_FOUND', 'Not found');
const invalid = (reply: FastifyReply, details: unknown) =>
  reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Check the fields and try again', details });

export function registerWalletRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  const clientExists = async (id: string) =>
    UUID.test(id) && (await sql`select 1 from clients where id = ${id}`.execute(db)).rows.length > 0;

  const pricesOf = async (clientId: string) => {
    const at = now();
    return Promise.all(
      CATEGORIES.map(async (category) => ({ category, pricePaise: await priceAt(db, clientId, category, at) })),
    );
  };

  // Client routes: balance, ledger and prices only. Meta's rates and the markup are never returned here.
  app.get('/api/clients/:clientId/wallet', async (req, reply) => {
    const { clientId } = req.scope!;
    const client = (
      await sql<{ low_balance_alert_paise: number | null }>`
        select low_balance_alert_paise from clients where id = ${clientId}
      `.execute(db)
    ).rows[0]!;
    const balancePaise = await readBalance(db, clientId);
    const onHoldPaise = await readOnHold(db, clientId);
    const holds = await sql`
      select h.campaign_id as "campaignId", k.name as "campaignName", k.scheduled_at as "scheduledAt", h.amount_paise as "amountPaise"
      from wallet_holds h join campaigns k on k.id = h.campaign_id and k.client_id = h.client_id
      where h.client_id = ${clientId} and h.released_at is null
      order by k.scheduled_at
    `.execute(db);
    return reply.code(200).send({
      balancePaise,
      onHoldPaise,
      availablePaise: balancePaise - onHoldPaise,
      holds: holds.rows,
      lowBalanceAlertPaise: client.low_balance_alert_paise,
    });
  });

  app.get('/api/clients/:clientId/wallet/ledger', async (req, reply) => {
    const { clientId } = req.scope!;
    const { limit, cursor } = readPage(req.query);
    const { kind, from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (
      (kind && !KINDS.has(kind)) ||
      (fromDate && Number.isNaN(fromDate.getTime())) ||
      (toDate && Number.isNaN(toDate.getTime()))
    ) {
      return invalid(reply, { kind, from, to });
    }
    const rows = await sql<{ id: number }>`
      select l.id, l.kind, l.amount_paise as "amountPaise", l.balance_after_paise as "balanceAfterPaise",
        l.campaign_id as "campaignId", l.message_id as "messageId", l.note, u.name as "createdBy", l.created_at as "createdAt"
      from wallet_ledger l
      left join users u on u.id = l.created_by
      where l.client_id = ${clientId}
        and ${cursor ? sql`l.id < ${cursor}` : sql`true`}
        and ${kind ? sql`l.kind = ${kind}` : sql`true`}
        and ${fromDate ? sql`l.created_at >= ${fromDate}` : sql`true`}
        and ${toDate ? sql`l.created_at <= ${toDate}` : sql`true`}
      order by l.id desc
      limit ${limit + 1}
    `.execute(db);
    return reply.code(200).send(toPage(rows.rows, limit));
  });

  app.get('/api/clients/:clientId/prices', async (req, reply) => {
    return reply.code(200).send({ items: await pricesOf(req.scope!.clientId) });
  });

  // Super admin: money in and out.
  const postLedger = (path: string, kind: LedgerKind) =>
    app.post(`/api/admin/clients/:id/wallet/${path}`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = (kind === 'topup' ? TopUp : Adjustment).safeParse(req.body);
      if (!parsed.success) return invalid(reply, parsed.error.flatten());
      if (!(await clientExists(id))) return notFound(reply);
      const { amountPaise, note } = parsed.data;
      const at = now();
      try {
        const row = await db.transaction().execute(async (trx) => {
          const entry = (await applyLedgerEntry(trx, {
            clientId: id,
            kind,
            amountPaise,
            note,
            createdBy: req.auth!.userId,
            at,
          }))!;
          await writeAudit(trx, {
            clientId: id,
            userId: req.auth!.userId,
            action: `wallet.${kind}`,
            entityType: 'wallet_ledger',
            entityId: String(entry.id),
            after: { amountPaise, balanceAfterPaise: entry.balanceAfterPaise },
            ...(note ? { note } : {}),
            at,
          });
          if (kind === 'topup') {
            await notify(trx, 'wallet.topped_up', { clientId: id, entityId: `${id}:${entry.id}` }, { amountPaise, balancePaise: entry.balanceAfterPaise });
          }
          return entry;
        });
        return reply.code(201).send(row);
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          return reply.code(402).send({
            error: 'INSUFFICIENT_BALANCE',
            message: 'This would take more than the available balance',
            shortPaise: err.shortPaise,
          });
        }
        throw err;
      }
    });
  postLedger('topups', 'topup');
  postLedger('adjustments', 'adjustment');

  app.patch('/api/admin/clients/:id/low-balance-alert', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = LowBalanceAlert.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    if (!(await clientExists(id))) return notFound(reply);
    await db.transaction().execute(async (trx) => {
      await sql`update clients set low_balance_alert_paise = ${parsed.data.alertPaise} where id = ${id}`.execute(trx);
      await writeAudit(trx, {
        clientId: id,
        userId: req.auth!.userId,
        action: 'wallet.alert_set',
        entityType: 'client',
        entityId: id,
        after: { alertPaise: parsed.data.alertPaise },
        at: now(),
      });
    });
    return reply.code(200).send({ alertPaise: parsed.data.alertPaise });
  });

  // Super admin: Meta's rates and what clients pay.
  app.get('/api/admin/meta-rates', async (_req, reply) => {
    const rows = await sql`
      select id, category, country_calling_code as "countryCallingCode", rate_centipaise as "rateCentipaise", valid_from as "validFrom"
      from meta_rates order by valid_from desc, category limit 500
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.post('/api/admin/meta-rates', async (req, reply) => {
    const parsed = MetaRateCreate.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { category, countryCallingCode, rateCentipaise, validFrom } = parsed.data;
    const at = now();
    const id = await db.transaction().execute(async (trx) => {
      const row = (
        await sql<{ id: string }>`
          insert into meta_rates (category, country_calling_code, rate_centipaise, valid_from, entered_by, created_at)
          values (${category}, ${countryCallingCode}, ${rateCentipaise}, ${new Date(validFrom)}, ${req.auth!.userId}, ${at})
          returning id
        `.execute(trx)
      ).rows[0]!;
      await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'meta_rate.added',
        entityType: 'meta_rate',
        entityId: row.id,
        after: parsed.data,
        at,
      });
      await recomputePrices(trx, at);
      return row.id;
    });
    return reply.code(201).send({ id });
  });

  app.get('/api/admin/pricing', async (_req, reply) => {
    const row = (
      await sql`
        select markup_marketing_bp as marketing, markup_utility_bp as utility, markup_authentication_bp as authentication
        from pricing where client_id is null order by seq desc limit 1
      `.execute(db)
    ).rows[0];
    return reply.code(200).send({ markupBp: row });
  });

  app.put('/api/admin/pricing', async (req, reply) => {
    const parsed = DefaultPricing.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { marketing, utility, authentication } = parsed.data.markupBp;
    const at = now();
    await db.transaction().execute(async (trx) => {
      const row = await sql<{ id: string }>`
        insert into pricing (client_id, mode, markup_marketing_bp, markup_utility_bp, markup_authentication_bp, valid_from, updated_by)
        values (null, 'markup', ${marketing}, ${utility}, ${authentication}, ${at}, ${req.auth!.userId})
        returning id
      `.execute(trx);
      await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'pricing.default_set',
        entityType: 'pricing',
        entityId: row.rows[0]!.id,
        after: parsed.data,
        at,
      });
      await recomputePrices(trx, at);
    });
    return reply.code(200).send(parsed.data);
  });

  app.get('/api/admin/clients/:id/pricing', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await clientExists(id))) return notFound(reply);
    const at = now();
    const own = (
      await sql`
        select mode, markup_marketing_bp as "markupMarketingBp", markup_utility_bp as "markupUtilityBp",
          markup_authentication_bp as "markupAuthenticationBp", fixed_marketing_paise as "fixedMarketingPaise",
          fixed_utility_paise as "fixedUtilityPaise", fixed_authentication_paise as "fixedAuthenticationPaise"
        from pricing where client_id = ${id} order by seq desc limit 1
      `.execute(db)
    ).rows[0];
    const prices = await Promise.all(
      CATEGORIES.map(async (category) => {
        const pricePaise = await priceAt(db, id, category, at);
        const rate = (
          await sql<{ rate_centipaise: number }>`
            select r.rate_centipaise from meta_rates r
            join clients c on c.country_calling_code = r.country_calling_code
            where c.id = ${id} and r.category = ${category} and r.valid_from <= ${at}
            order by r.valid_from desc, r.seq desc limit 1
          `.execute(db)
        ).rows[0];
        const rateCentipaise = rate?.rate_centipaise ?? null;
        return {
          category,
          pricePaise,
          metaRateCentipaise: rateCentipaise,
          // A fixed price does not follow Meta's rate, so it can fall below cost (question P6).
          belowCost: pricePaise !== null && rateCentipaise !== null && pricePaise * 100 < rateCentipaise,
        };
      }),
    );
    return reply.code(200).send({ pricing: own ?? { mode: 'default' }, prices });
  });

  app.put('/api/admin/clients/:id/pricing', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ClientPricing.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    if (!(await clientExists(id))) return notFound(reply);
    const body = parsed.data;
    const markup = body.mode === 'markup' ? body.markupBp : null;
    const fixed = body.mode === 'fixed' ? body.fixedPaise : null;
    const at = now();
    await db.transaction().execute(async (trx) => {
      const row = await sql<{ id: string }>`
        insert into pricing (
          client_id, mode, markup_marketing_bp, markup_utility_bp, markup_authentication_bp,
          fixed_marketing_paise, fixed_utility_paise, fixed_authentication_paise, valid_from, updated_by
        )
        values (
          ${id}, ${body.mode}, ${markup?.marketing ?? null}, ${markup?.utility ?? null}, ${markup?.authentication ?? null},
          ${fixed?.marketing ?? null}, ${fixed?.utility ?? null}, ${fixed?.authentication ?? null}, ${at}, ${req.auth!.userId}
        )
        returning id
      `.execute(trx);
      await writeAudit(trx, {
        clientId: id,
        userId: req.auth!.userId,
        action: 'pricing.client_set',
        entityType: 'pricing',
        entityId: row.rows[0]!.id,
        after: body,
        at,
      });
      await recomputePrices(trx, at, id);
    });
    return reply.code(200).send(body);
  });

  app.get('/api/admin/charge-policy', async (req, reply) => {
    const { clientId } = req.query as { clientId?: string };
    if (clientId) {
      if (!(await clientExists(clientId))) return notFound(reply);
      return reply.code(200).send({ clientId, policy: await chargePolicyFor(db, clientId) });
    }
    const rows = await sql<{ outcome: string; charged: boolean }>`
      select outcome, charged from charge_policy where client_id is null order by outcome
    `.execute(db);
    return reply.code(200).send({
      clientId: null,
      policy: Object.fromEntries(rows.rows.map((r) => [r.outcome, r.charged])),
    });
  });

  app.put('/api/admin/charge-policy', async (req, reply) => {
    const parsed = ChargePolicyUpdate.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { clientId, outcome, charged } = parsed.data;
    if (clientId && !(await clientExists(clientId))) return notFound(reply);
    await db.transaction().execute(async (trx) => {
      if (clientId) {
        await sql`
          insert into charge_policy (client_id, outcome, charged) values (${clientId}, ${outcome}, ${charged})
          on conflict (client_id, outcome) where client_id is not null do update set charged = excluded.charged
        `.execute(trx);
      } else {
        await sql`update charge_policy set charged = ${charged} where client_id is null and outcome = ${outcome}`.execute(trx);
      }
      await writeAudit(trx, {
        clientId,
        userId: req.auth!.userId,
        action: 'charge_policy.set',
        entityType: 'charge_policy',
        entityId: outcome,
        after: { charged },
        at: now(),
      });
    });
    return reply.code(200).send(parsed.data);
  });
}
