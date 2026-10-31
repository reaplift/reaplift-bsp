import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { randomInt } from 'node:crypto';
import { ConnectAccount, EmbeddedSignup, ReplaceToken, SendLimits } from '@reaplift/shared';
import { encryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { MetaClient } from '../../lib/meta-client.js';
import { sendError } from '../auth/scope.js';
import { writeAudit } from '../admin/audit.js';
import { UserInputError } from '../auth/users.js';
import { notify } from '../notifications/notify.js';
import { connectAccount } from './account.js';
import { readLimitUsage } from './limits.js';

const CREDIT_NOT_SHARED = 'credit line not shared';
/** Which currency Meta invoices the credit line in is question 2 in docs/open-questions.md. */
const CREDIT_CURRENCY = 'INR';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account box. The token is never selected, so no route can return it. */
const ACCOUNT_BOX = sql`
  id, client_id as "clientId", waba_id as "wabaId", phone_number_id as "phoneNumberId",
  display_phone as "displayPhone", display_name as "displayName", quality_rating as "qualityRating",
  messaging_limit as "messagingLimit", send_rate_per_sec as "sendRatePerSec", daily_send_limit as "dailySendLimit", meta_payer as "metaPayer", status, paused_reason as "pausedReason",
  onboarded_via as "onboardedVia", connected_at as "connectedAt"
`;

export function registerAccountRoutes(
  app: FastifyInstance,
  deps: {
    db: Kysely<Database>;
    now: () => Date;
    meta?: MetaClient;
    encryptionKey?: string;
    metaAppId: string;
    metaAppSecret: string;
    metaSystemToken: string;
    metaCreditLineId: string;
  },
) {
  const { db, now, meta, encryptionKey, metaAppId, metaAppSecret, metaSystemToken, metaCreditLineId } = deps;

  /** Shares ReapLift's credit line with the account. Meta's error 4000 means it is already shared. */
  const shareCredit = async (wabaId: string): Promise<{ shared: boolean; ref: string | null }> => {
    if (!meta || !metaSystemToken || !metaCreditLineId) return { shared: false, ref: null };
    const result = await meta.shareCreditLine(metaCreditLineId, metaSystemToken, wabaId, CREDIT_CURRENCY);
    if (result.ok) return { shared: true, ref: result.data.allocation_config_id ?? null };
    return { shared: result.code === 4000, ref: null };
  };

  app.post('/api/admin/clients/:id/wa-accounts', async (req, reply) => {
    const clientId = (req.params as { id: string }).id;
    const parsed = ConnectAccount.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_REQUEST', 'Send wabaId, phoneNumberId and token');
    }
    if (!meta || !encryptionKey) {
      return sendError(reply, 503, 'NOT_CONFIGURED', 'Set APP_ENCRYPTION_KEY before connecting a number');
    }
    const client = UUID.test(clientId)
      ? (await sql`select 1 from clients where id = ${clientId}`.execute(db)).rows[0]
      : undefined;
    if (!client) return sendError(reply, 404, 'NOT_FOUND', 'Not found');

    let connected: Awaited<ReturnType<typeof connectAccount>>;
    try {
      connected = await connectAccount(
        db,
        meta,
        { ...parsed.data, clientId, connectedBy: req.auth!.userId },
        encryptionKey,
      );
    } catch (err) {
      if (err instanceof UserInputError) return sendError(reply, 400, 'META_REFUSED', err.message);
      throw err;
    }

    const account = await db.transaction().execute(async (trx) => {
      const row = (
        await sql<{ displayPhone: string }>`
          select ${ACCOUNT_BOX} from wa_accounts where id = ${connected.waAccountId} and client_id = ${clientId}
        `.execute(trx)
      ).rows[0]!;
      await sql`
        insert into audit_logs (client_id, user_id, action, entity_type, entity_id, created_at)
        values (${clientId}, ${req.auth!.userId}, 'wa_account.connected', 'wa_account', ${connected.waAccountId}, ${now()})
      `.execute(trx);
      await notify(
        trx,
        'account.connected',
        { clientId, entityId: connected.waAccountId },
        { number: row.displayPhone },
      );
      return row;
    });
    return reply.code(201).send(account);
  });

  app.post('/api/clients/:clientId/wa-accounts/embedded-signup', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const parsed = EmbeddedSignup.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send code, wabaId and phoneNumberId');
    if (!meta || !encryptionKey || !metaAppId || !metaAppSecret) {
      return sendError(reply, 503, 'NOT_CONFIGURED', 'Embedded Signup is not set up on this server');
    }
    const { code, wabaId, phoneNumberId } = parsed.data;

    const taken = (
      await sql`select 1 from wa_accounts where phone_number_id = ${phoneNumberId}`.execute(db)
    ).rows[0];
    if (taken) return sendError(reply, 409, 'ALREADY_CONNECTED', 'This number is already connected');

    const refused = (step: string, code?: number) =>
      sendError(reply, 400, 'META_REFUSED', `Meta refused the ${step}${code === undefined ? '' : ` (code ${code})`}`);

    const exchanged = await meta.exchangeCode(metaAppId, metaAppSecret, code);
    if (!exchanged.ok || !exchanged.data.access_token) {
      return refused('signup code', exchanged.ok ? undefined : exchanged.code);
    }
    const token = exchanged.data.access_token;

    const subscribed = await meta.subscribeApp(wabaId, token);
    if (!subscribed.ok) return refused('webhook subscription', subscribed.code);

    const credit = await shareCredit(wabaId);

    const pin = String(randomInt(100000, 1000000));
    const registered = await meta.registerNumber(phoneNumberId, token, pin);
    if (!registered.ok) return refused('number registration', registered.code);

    let connected: Awaited<ReturnType<typeof connectAccount>>;
    try {
      connected = await connectAccount(
        db,
        meta,
        {
          clientId,
          wabaId,
          phoneNumberId,
          token,
          connectedBy: userId,
          seed: {
            onboardedVia: 'embedded_signup',
            metaPayer: 'reaplift_credit_line',
            twoStepPin: pin,
            creditShareRef: credit.ref,
            // Paused, so nothing can be sent at ReapLift's cost or the client's by mistake.
            ...(credit.shared ? {} : { status: 'paused' as const, pausedReason: CREDIT_NOT_SHARED }),
          },
        },
        encryptionKey,
      );
    } catch (err) {
      if (err instanceof UserInputError) return sendError(reply, 400, 'META_REFUSED', err.message);
      throw err;
    }

    const account = await db.transaction().execute(async (trx) => {
      const row = (
        await sql<{ displayPhone: string }>`
          select ${ACCOUNT_BOX} from wa_accounts where id = ${connected.waAccountId} and client_id = ${clientId}
        `.execute(trx)
      ).rows[0]!;
      await sql`
        insert into audit_logs (client_id, user_id, action, entity_type, entity_id, created_at)
        values (${clientId}, ${userId}, 'wa_account.connected', 'wa_account', ${connected.waAccountId}, ${now()})
      `.execute(trx);
      await notify(trx, 'account.connected', { clientId, entityId: connected.waAccountId }, { number: row.displayPhone });
      return row;
    });
    return reply.code(201).send(account);
  });

  app.post('/api/admin/wa-accounts/:id/share-credit', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const account = (
      await sql<{ client_id: string; waba_id: string; paused_reason: string | null }>`
        select client_id, waba_id, paused_reason from wa_accounts where id = ${id}
      `.execute(db)
    ).rows[0];
    if (!account) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    if (account.paused_reason !== CREDIT_NOT_SHARED) {
      return sendError(reply, 409, 'NOT_PAUSED', 'This number is not waiting for the credit line');
    }
    const credit = await shareCredit(account.waba_id);
    if (!credit.shared) return sendError(reply, 400, 'META_REFUSED', 'The credit line could not be shared');

    await db.transaction().execute(async (trx) => {
      await sql`
        update wa_accounts
        set status = 'active', paused_reason = null, credit_share_ref = coalesce(${credit.ref}, credit_share_ref)
        where id = ${id} and client_id = ${account.client_id}
      `.execute(trx);
      await sql`
        insert into audit_logs (client_id, user_id, action, entity_type, entity_id, created_at)
        values (${account.client_id}, ${req.auth!.userId}, 'wa_account.credit_shared', 'wa_account', ${id}, ${now()})
      `.execute(trx);
    });
    return reply.code(200).send({ status: 'active' });
  });

  app.get('/api/admin/limits-usage', async (_req, reply) => {
    return reply.code(200).send(await readLimitUsage(db, now()));
  });

  // Applies from the worker's next round, with no restart.
  app.patch('/api/admin/wa-accounts/:id/limits', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const parsed = SendLimits.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send sendRatePerSec (1 to 1000) or dailySendLimit');
    const saved = await db.transaction().execute(async (trx) => {
      const before = (
        await sql<{ client_id: string; send_rate_per_sec: number; daily_send_limit: number | null }>`
          select client_id, send_rate_per_sec, daily_send_limit from wa_accounts where id = ${id} for update
        `.execute(trx)
      ).rows[0];
      if (!before) return null;
      const sendRatePerSec = parsed.data.sendRatePerSec ?? before.send_rate_per_sec;
      const dailySendLimit = parsed.data.dailySendLimit === undefined ? before.daily_send_limit : parsed.data.dailySendLimit;
      await sql`
        update wa_accounts set send_rate_per_sec = ${sendRatePerSec}, daily_send_limit = ${dailySendLimit}
        where id = ${id} and client_id = ${before.client_id}
      `.execute(trx);
      await writeAudit(trx, {
        clientId: before.client_id,
        userId: req.auth!.userId,
        action: 'wa_account.limits_set',
        entityType: 'wa_account',
        entityId: id,
        before: { sendRatePerSec: before.send_rate_per_sec, dailySendLimit: before.daily_send_limit },
        after: { sendRatePerSec, dailySendLimit },
        at: now(),
      });
      return { sendRatePerSec, dailySendLimit };
    });
    if (!saved) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    return reply.code(200).send(saved);
  });

  app.post('/api/admin/wa-accounts/:id/token', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ReplaceToken.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send the new token');
    if (!meta || !encryptionKey) {
      return sendError(reply, 503, 'NOT_CONFIGURED', 'Set APP_ENCRYPTION_KEY before replacing a token');
    }
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const account = (
      await sql<{ client_id: string; waba_id: string; phone_number_id: string }>`
        select client_id, waba_id, phone_number_id from wa_accounts where id = ${id}
      `.execute(db)
    ).rows[0];
    if (!account) return sendError(reply, 404, 'NOT_FOUND', 'Not found');

    const numbers = await meta.listPhoneNumbers(account.waba_id, parsed.data.token);
    if (!numbers.ok || !numbers.data.data.some((n) => n.id === account.phone_number_id)) {
      return sendError(reply, 400, 'META_REFUSED', 'Meta refused this token for this number');
    }
    await db.transaction().execute(async (trx) => {
      await sql`
        update wa_accounts set access_token_enc = ${Buffer.from(encryptSecret(parsed.data.token, encryptionKey), 'utf8')}
        where id = ${id} and client_id = ${account.client_id}
      `.execute(trx);
      await sql`
        insert into audit_logs (client_id, user_id, action, entity_type, entity_id, created_at)
        values (${account.client_id}, ${req.auth!.userId}, 'wa_account.token_replaced', 'wa_account', ${id}, ${now()})
      `.execute(trx);
    });
    return reply.code(200).send({ replaced: true });
  });

  app.post('/api/admin/wa-accounts/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');

    const result = await db.transaction().execute(async (trx) => {
      const account = (
        await sql<{ client_id: string; display_phone: string; status: string; paused_reason: string | null }>`
          select client_id, display_phone, status, paused_reason from wa_accounts where id = ${id} for update
        `.execute(trx)
      ).rows[0];
      if (!account) return 'missing' as const;
      if (account.status !== 'paused') return 'not-paused' as const;
      if (account.paused_reason === CREDIT_NOT_SHARED) return 'no-credit' as const;

      await sql`update wa_accounts set status = 'active', paused_reason = null where id = ${id}`.execute(trx);
      const audit = await sql<{ id: number }>`
        insert into audit_logs (client_id, user_id, action, entity_type, entity_id, details, created_at)
        values (
          ${account.client_id}, ${req.auth!.userId}, 'wa_account.resumed', 'wa_account', ${id},
          ${JSON.stringify({ pausedReason: account.paused_reason })}::jsonb, ${now()}
        )
        returning id
      `.execute(trx);
      await notify(
        trx,
        'account.resumed',
        { clientId: account.client_id, entityId: `${id}:${audit.rows[0]!.id}` },
        { number: account.display_phone },
      );
      return 'resumed' as const;
    });

    if (result === 'missing') return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    if (result === 'no-credit') {
      return sendError(reply, 409, 'CREDIT_NOT_SHARED', 'Share the credit line first; that also resumes this number');
    }
    if (result === 'not-paused') return sendError(reply, 409, 'NOT_PAUSED', 'This number is not paused');
    return reply.code(200).send({ status: 'active' });
  });

  app.get('/api/clients/:clientId/wa-accounts', async (req, reply) => {
    const { clientId } = req.scope!;
    const rows = await sql`
      select ${ACCOUNT_BOX} from wa_accounts where client_id = ${clientId} order by created_at
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });
}
