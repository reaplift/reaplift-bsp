import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { CampaignCreate, CampaignEdit, NumberColumn, OptOutUpload, SettingWords } from '@reaplift/shared';
import { csvLine } from '../../lib/csv.js';
import type { Database } from '../../lib/db.js';
import { writeAudit } from '../admin/audit.js';
import { estimateDelivery } from '../messaging/limits.js';
import { sendError } from '../auth/scope.js';
import { notify } from '../notifications/notify.js';
import { InsufficientBalanceError } from '../wallet/ledger.js';
import { CampaignRefused, computeSummary, confirmCampaign, publicSummary, type CampaignRow } from './campaign.js';
import { CSV_TYPE, readAudienceFile, TooManyRowsError, UnreadableFileError, XLSX_TYPE } from './file-reader.js';
import { cleanNumber, cleanRows } from './numbers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 5000;
const EDITABLE_SETTINGS = new Set(['promo_words', 'stop_words']);
const META_LIMIT_CODE = 131049;

const notFound = (reply: FastifyReply) => sendError(reply, 404, 'NOT_FOUND', 'Not found');
const invalid = (reply: FastifyReply, details: unknown) =>
  reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Check the fields and try again', details });

const CAMPAIGN = sql`
  id, client_id as "clientId", name, template_id as "templateId", wa_account_id as "waAccountId", list_id as "listId",
  variable_map as "variableMap", status, created_by as "createdBy", confirmed_by as "confirmedBy", confirmed_at as "confirmedAt",
  total, blocked, sent, delivered, read, failed, scheduled_at as "scheduledAt", cancelled_at as "cancelledAt",
  created_at as "createdAt", updated_at as "updatedAt"
`;

export function registerCampaignRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; uploadDir: string; uploadMaxBytes: number; listMaxRows: number },
) {
  const { db, now, uploadDir, uploadMaxBytes, listMaxRows } = deps;

  app.addContentTypeParser([CSV_TYPE, XLSX_TYPE], { parseAs: 'buffer', bodyLimit: uploadMaxBytes }, (_req, body, done) =>
    done(null, body),
  );

  const readList = async (clientId: string, id: string) => {
    if (!UUID.test(id)) return undefined;
    return (
      await sql<{
        id: string;
        file_name: string;
        row_count: number;
        blank_rows_skipped: number;
        columns: string[];
        number_column: number | null;
        valid_count: number | null;
        invalid_count: number | null;
        duplicate_count: number | null;
      }>`
        select id, file_name, row_count, blank_rows_skipped, columns, number_column, valid_count, invalid_count, duplicate_count
        from lists where id = ${id} and client_id = ${clientId}
      `.execute(db)
    ).rows[0];
  };

  app.post('/api/clients/:clientId/lists', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const { fileName, optIn } = req.query as { fileName?: string; optIn?: string };
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (type !== CSV_TYPE && type !== XLSX_TYPE) {
      return sendError(reply, 400, 'FILE_NOT_ALLOWED', 'Upload an Excel (.xlsx) or CSV file');
    }
    if (optIn !== 'true') {
      return sendError(reply, 400, 'OPT_IN_REQUIRED', 'Confirm that every number in this file opted in');
    }
    const bytes = req.body as Buffer;

    let parsed: Awaited<ReturnType<typeof readAudienceFile>>;
    try {
      parsed = await readAudienceFile(bytes, type, listMaxRows);
    } catch (err) {
      if (err instanceof UnreadableFileError) return sendError(reply, 400, 'FILE_UNREADABLE', err.message);
      if (err instanceof TooManyRowsError) return sendError(reply, 400, 'LIST_TOO_LONG', err.message);
      throw err;
    }

    const at = now();
    const id = await db.transaction().execute(async (trx) => {
      const safeName = path.basename(fileName ?? 'audience').slice(0, 200) || 'audience';
      const row = (
        await sql<{ id: string }>`
          insert into lists (client_id, file_name, storage_key, row_count, blank_rows_skipped, columns, opt_in_confirmed_by, opt_in_confirmed_at, created_by, created_at)
          values (
            ${clientId}, ${safeName}, '', ${parsed.rows.length}, ${parsed.blankRowsSkipped}, ${JSON.stringify(parsed.columns)}::jsonb,
            ${userId}, ${at}, ${userId}, ${at}
          )
          returning id
        `.execute(trx)
      ).rows[0]!;
      for (let i = 0; i < parsed.rows.length; i += BATCH) {
        const batch = parsed.rows.slice(i, i + BATCH);
        await sql`
          insert into list_contacts (list_id, row_number, client_id, cells)
          select ${row.id}::uuid, r, ${clientId}::uuid, c::jsonb
          from unnest(${batch.map((b) => b.row)}::int[], ${batch.map((b) => JSON.stringify(b.cells))}::text[]) as t(r, c)
        `.execute(trx);
      }
      const storageKey = path.join(clientId, 'lists', `${row.id}.${type === CSV_TYPE ? 'csv' : 'xlsx'}`);
      await mkdir(path.join(uploadDir, clientId, 'lists'), { recursive: true });
      await writeFile(path.join(uploadDir, storageKey), bytes);
      await sql`update lists set storage_key = ${storageKey} where id = ${row.id}`.execute(trx);
      return row.id;
    });

    return reply.code(201).send({
      id,
      rowCount: parsed.rows.length,
      blankRowsSkipped: parsed.blankRowsSkipped,
      columns: parsed.columns,
      preview: parsed.rows.slice(0, 10).map((r) => r.cells),
    });
  });

  app.get('/api/clients/:clientId/lists/:id', async (req, reply) => {
    const { clientId } = req.scope!;
    const list = await readList(clientId, (req.params as { id: string }).id);
    if (!list) return notFound(reply);
    const preview = await sql<{ cells: string[] }>`
      select cells from list_contacts where list_id = ${list.id} and client_id = ${clientId} order by row_number limit 10
    `.execute(db);
    return reply.code(200).send({
      id: list.id,
      fileName: list.file_name,
      rowCount: list.row_count,
      blankRowsSkipped: list.blank_rows_skipped,
      columns: list.columns,
      numberColumn: list.number_column,
      validCount: list.valid_count,
      invalidCount: list.invalid_count,
      duplicateCount: list.duplicate_count,
      preview: preview.rows.map((r) => r.cells),
    });
  });

  app.put('/api/clients/:clientId/lists/:id/number-column', async (req, reply) => {
    const { clientId } = req.scope!;
    const list = await readList(clientId, (req.params as { id: string }).id);
    if (!list) return notFound(reply);
    const parsed = NumberColumn.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { column } = parsed.data;
    if (column >= list.columns.length) return sendError(reply, 400, 'COLUMN_OUT_OF_RANGE', 'This column is not in the list');

    const counts = await db.transaction().execute(async (trx) => {
      const rows = (
        await sql<{ row_number: number; value: string | null }>`
          select row_number, cells->>${column}::int as value from list_contacts
          where list_id = ${list.id} and client_id = ${clientId} order by row_number
          for update
        `.execute(trx)
      ).rows;
      const cleaned = cleanRows(rows.map((r) => ({ row: r.row_number, value: r.value })));
      for (let i = 0; i < cleaned.length; i += BATCH) {
        const batch = cleaned.slice(i, i + BATCH);
        await sql`
          update list_contacts lc
          set number = t.number, invalid_reason = t.reason, duplicate_of_row = t.duplicate
          from unnest(
            ${batch.map((b) => b.row)}::int[], ${batch.map((b) => b.number)}::text[],
            ${batch.map((b) => b.invalidReason)}::text[], ${batch.map((b) => b.duplicateOfRow)}::int[]
          ) as t(row_number, number, reason, duplicate)
          where lc.list_id = ${list.id} and lc.client_id = ${clientId} and lc.row_number = t.row_number
        `.execute(trx);
      }
      const validCount = cleaned.filter((c) => c.number).length;
      const invalidCount = cleaned.filter((c) => c.invalidReason).length;
      const duplicateCount = cleaned.filter((c) => c.duplicateOfRow !== null).length;
      await sql`
        update lists set number_column = ${column}, valid_count = ${validCount}, invalid_count = ${invalidCount}, duplicate_count = ${duplicateCount}
        where id = ${list.id} and client_id = ${clientId}
      `.execute(trx);
      return { validCount, invalidCount, duplicateCount };
    });
    return reply.code(200).send({ numberColumn: column, ...counts });
  });

  app.get('/api/clients/:clientId/lists/:id/invalid', async (req, reply) => {
    const { clientId } = req.scope!;
    const list = await readList(clientId, (req.params as { id: string }).id);
    if (!list) return notFound(reply);
    const rows = await sql<{ row_number: number; cells: string[]; invalid_reason: string | null; duplicate_of_row: number | null }>`
      select row_number, cells, invalid_reason, duplicate_of_row from list_contacts
      where list_id = ${list.id} and client_id = ${clientId} and (invalid_reason is not null or duplicate_of_row is not null)
      order by row_number
    `.execute(db);
    const lines = [
      csvLine(['Row', 'Reason', ...list.columns]),
      ...rows.rows.map((r) => csvLine([r.row_number, r.invalid_reason ?? `duplicate of row ${r.duplicate_of_row}`, ...r.cells])),
    ];
    return reply
      .code(200)
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="invalid-rows.csv"')
      .send(lines.join(''));
  });

  /** Only an approved template of this client's active number can start a campaign. */
  const readTemplate = async (clientId: string, id: string) =>
    (
      await sql<{ id: string; wa_account_id: string; status: string }>`
        select id, wa_account_id, status from templates where id = ${id} and client_id = ${clientId}
      `.execute(db)
    ).rows[0];

  const listBelongs = async (clientId: string, id: string) => Boolean(await readList(clientId, id));

  app.get('/api/clients/:clientId/campaigns', async (req, reply) => {
    const rows = await sql`
      select ${CAMPAIGN} from campaigns where client_id = ${req.scope!.clientId} order by created_at desc, id limit 500
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.post('/api/clients/:clientId/campaigns', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const parsed = CampaignCreate.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { name, templateId, listId, variableMap } = parsed.data;
    const template = await readTemplate(clientId, templateId);
    if (!template) return notFound(reply);
    if (template.status !== 'APPROVED') {
      return sendError(reply, 400, 'TEMPLATE_NOT_APPROVED', `The template is ${template.status}`);
    }
    if (listId && !(await listBelongs(clientId, listId))) return notFound(reply);
    const at = now();
    const row = await sql`
      insert into campaigns (client_id, name, template_id, wa_account_id, list_id, variable_map, created_by, created_at, updated_at)
      values (
        ${clientId}, ${name}, ${templateId}, ${template.wa_account_id}, ${listId ?? null}, ${JSON.stringify(variableMap ?? {})}::jsonb,
        ${userId}, ${at}, ${at}
      )
      returning ${CAMPAIGN}
    `.execute(db);
    return reply.code(201).send(row.rows[0]);
  });

  const readCampaign = async (clientId: string, id: string) => {
    if (!UUID.test(id)) return undefined;
    return (
      await sql<CampaignRow>`select * from campaigns where id = ${id} and client_id = ${clientId}`.execute(db)
    ).rows[0];
  };

  app.get('/api/clients/:clientId/campaigns/:id', async (req, reply) => {
    const { clientId } = req.scope!;
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const row = (
      await sql`select ${CAMPAIGN} from campaigns where id = ${id} and client_id = ${clientId}`.execute(db)
    ).rows[0];
    if (!row) return notFound(reply);
    const money = (
      await sql<{ charged: number; refunded: number }>`
        select coalesce(-sum(amount_paise) filter (where kind = 'charge'), 0)::bigint as charged,
          coalesce(sum(amount_paise) filter (where kind = 'refund'), 0)::bigint as refunded
        from wallet_ledger where client_id = ${clientId} and campaign_id = ${id}
      `.execute(db)
    ).rows[0]!;
    const failures = await sql<{ code: number | null; reason: string | null; count: number }>`
      select meta_error_code as code, failure_reason as reason, count(*)::int as count
      from messages where client_id = ${clientId} and campaign_id = ${id} and status = 'failed'
      group by meta_error_code, failure_reason order by count desc
    `.execute(db);
    const { status, waAccountId } = row as { status: string; waAccountId: string };
    return reply.code(200).send({
      ...(row as object),
      // Counts every message waiting on the number, this campaign's included.
      estimate: status === 'running' ? await estimateDelivery(db, waAccountId, 0, now()) : null,
      chargedPaise: money.charged,
      refundedPaise: money.refunded,
      failures: failures.rows.map((f) => ({
        ...f,
        label: f.code === META_LIMIT_CODE ? 'Meta limit, not retried' : (f.reason ?? 'Failed at Meta'),
      })),
    });
  });

  app.put('/api/clients/:clientId/campaigns/:id', async (req, reply) => {
    const { clientId } = req.scope!;
    const { id } = req.params as { id: string };
    const campaign = await readCampaign(clientId, id);
    if (!campaign) return notFound(reply);
    if (campaign.status !== 'draft') return sendError(reply, 409, 'NOT_A_DRAFT', `This campaign is ${campaign.status}`);
    const parsed = CampaignEdit.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const body = parsed.data;

    let accountId = campaign.wa_account_id;
    if (body.templateId) {
      const template = await readTemplate(clientId, body.templateId);
      if (!template) return notFound(reply);
      if (template.status !== 'APPROVED') {
        return sendError(reply, 400, 'TEMPLATE_NOT_APPROVED', `The template is ${template.status}`);
      }
      accountId = template.wa_account_id;
    }
    if (body.listId && !(await listBelongs(clientId, body.listId))) return notFound(reply);

    const listId = body.listId === undefined ? campaign.list_id : body.listId;
    const row = await sql`
      update campaigns
      set name = ${body.name ?? campaign.name}, template_id = ${body.templateId ?? campaign.template_id}, wa_account_id = ${accountId},
        list_id = ${listId}, variable_map = ${JSON.stringify(body.variableMap ?? campaign.variable_map)}::jsonb, updated_at = ${now()}
      where id = ${id} and client_id = ${clientId} and status = 'draft'
      returning ${CAMPAIGN}
    `.execute(db);
    if (!row.rows[0]) return sendError(reply, 409, 'NOT_A_DRAFT', 'This campaign has just changed; reload it');
    return reply.code(200).send(row.rows[0]);
  });

  const refused = (reply: FastifyReply, err: CampaignRefused) =>
    reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });

  app.get('/api/clients/:clientId/campaigns/:id/summary', async (req, reply) => {
    const { clientId } = req.scope!;
    const campaign = await readCampaign(clientId, (req.params as { id: string }).id);
    if (!campaign) return notFound(reply);
    try {
      return reply.code(200).send(publicSummary(await computeSummary(db, campaign, now())));
    } catch (err) {
      if (err instanceof CampaignRefused) return refused(reply, err);
      throw err;
    }
  });

  app.post('/api/clients/:clientId/campaigns/:id/confirm', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const { id } = req.params as { id: string };
    const campaign = await readCampaign(clientId, id);
    if (!campaign) return notFound(reply);
    const at = now();
    try {
      const summary = await db.transaction().execute((trx) => confirmCampaign(trx, clientId, id, userId, at));
      return reply.code(200).send(summary);
    } catch (err) {
      if (err instanceof CampaignRefused) return refused(reply, err);
      if (err instanceof InsufficientBalanceError) {
        await db.transaction().execute((trx) =>
          notify(
            trx,
            'campaign.blocked_balance',
            { clientId, userId, entityId: `${id}:${at.toISOString()}` },
            { name: campaign.name, shortPaise: err.shortPaise },
          ),
        );
        return reply.code(402).send({
          error: 'INSUFFICIENT_BALANCE',
          message: 'Top up needed',
          shortPaise: err.shortPaise,
        });
      }
      throw err;
    }
  });

  app.post('/api/admin/clients/:id/opt-outs', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = OptOutUpload.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    if (!UUID.test(id) || !(await sql`select 1 from clients where id = ${id}`.execute(db)).rows[0]) return notFound(reply);
    const results = parsed.data.numbers.map(cleanNumber);
    const numbers = [...new Set(results.flatMap((r) => ('number' in r ? [r.number] : [])))];
    const added = await db.transaction().execute(async (trx) => {
      const inserted = await sql`
        insert into opt_outs (client_id, number, source, created_at)
        select ${id}::uuid, n, 'upload', ${now()} from unnest(${numbers}::text[]) as n
        on conflict (client_id, number) do nothing
      `.execute(trx);
      const count = Number(inserted.numAffectedRows ?? 0);
      await writeAudit(trx, {
        clientId: id,
        userId: req.auth!.userId,
        action: 'opt_outs.uploaded',
        entityType: 'client',
        entityId: id,
        after: { added: count },
        at: now(),
      });
      return count;
    });
    return reply.code(200).send({ added, invalid: results.length - results.filter((r) => 'number' in r).length });
  });

  app.get('/api/admin/clients/:id/opt-outs', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id) || !(await sql`select 1 from clients where id = ${id}`.execute(db)).rows[0]) return notFound(reply);
    const rows = await sql`
      select number, source, created_at as "createdAt" from opt_outs where client_id = ${id} order by created_at desc, number limit 500
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  // For a number added by mistake. Meta's policy requires honouring a real opt-out, so this is audited.
  app.delete('/api/admin/clients/:id/opt-outs/:number', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    if (!UUID.test(id)) return notFound(reply);
    const removed = await db.transaction().execute(async (trx) => {
      const gone = (
        await sql<{ source: string }>`delete from opt_outs where client_id = ${id} and number = ${number} returning source`.execute(trx)
      ).rows[0];
      if (!gone) return false;
      await writeAudit(trx, {
        clientId: id,
        userId: req.auth!.userId,
        action: 'opt_out.removed',
        entityType: 'opt_out',
        entityId: number,
        before: { source: gone.source },
        at: now(),
      });
      return true;
    });
    if (!removed) return notFound(reply);
    return reply.code(200).send({ removed: true });
  });

  app.get('/api/admin/settings/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!EDITABLE_SETTINGS.has(key)) return notFound(reply);
    const row = (await sql<{ value: string[] }>`select value from settings where key = ${key}`.execute(db)).rows[0];
    return reply.code(200).send({ key, value: row?.value ?? [] });
  });

  app.put('/api/admin/settings/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!EDITABLE_SETTINGS.has(key)) return notFound(reply);
    const parsed = SettingWords.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const at = now();
    await db.transaction().execute(async (trx) => {
      await sql`
        insert into settings (key, value, updated_by, updated_at)
        values (${key}, ${JSON.stringify(parsed.data.value)}::jsonb, ${req.auth!.userId}, ${at})
        on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `.execute(trx);
      await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'settings.changed',
        entityType: 'settings',
        entityId: key,
        after: parsed.data.value,
        at,
      });
    });
    return reply.code(200).send({ key, value: parsed.data.value });
  });
}
