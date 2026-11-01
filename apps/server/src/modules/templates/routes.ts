import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { TemplateCopy, TemplateCreate, TemplateEdit, type TemplateComponent } from '@reaplift/shared';
import { decryptSecret } from '../../lib/crypto.js';
import type { Database } from '../../lib/db.js';
import type { MetaClient } from '../../lib/meta-client.js';
import { sendError } from '../auth/scope.js';
import { countVariables } from '../messaging/account.js';
import { checkTemplate } from './rules.js';
import { explainRejection } from './status.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = new Set(['DRAFT', 'VALIDATION_FAILED', 'REJECTED']);
const SUBMITTABLE = new Set(['DRAFT', 'VALIDATION_FAILED']);

/**
 * What a media header may hold. Types and sizes checked against Meta's media page; see docs/open-questions.md
 * for sizes specific to review samples.
 */
const MB = 1024 * 1024;
const MEDIA_TYPES: Record<string, { format: TemplateComponent['format']; extension: string; maxBytes: number }> = {
  'image/jpeg': { format: 'IMAGE', extension: 'jpg', maxBytes: 5 * MB },
  'image/png': { format: 'IMAGE', extension: 'png', maxBytes: 5 * MB },
  'video/mp4': { format: 'VIDEO', extension: 'mp4', maxBytes: 16 * MB },
  'application/pdf': { format: 'DOCUMENT', extension: 'pdf', maxBytes: 100 * MB },
};
const MAX_MEDIA_BYTES = 100 * MB;

const COLUMNS = sql`
  id, client_id as "clientId", wa_account_id as "waAccountId", meta_template_id as "metaTemplateId", name, language,
  category, components, variable_count as "variableCount", status, validation_errors as "validationErrors",
  submitted_at as "submittedAt", rejection_reason as "rejectionReason", meta_recommendation as "metaRecommendation",
  updated_at as "updatedAt"
`;

interface TemplateView {
  id: string;
  status: string;
  rejectionReason: string | null;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string;
  components: TemplateComponent[];
  waAccountId: string;
}

const view = (row: TemplateView) => ({ ...row, rejectionExplanation: explainRejection(row.rejectionReason) });

const isNameTaken = (err: unknown) => (err as { code?: string }).code === '23505';
const nameTaken = (reply: FastifyReply) =>
  sendError(reply, 409, 'NAME_TAKEN', 'This account already has a template with this name and language');

async function readOne(db: Kysely<Database>, clientId: string, id: string) {
  if (!UUID.test(id)) return undefined;
  return (
    await sql<TemplateView>`select ${COLUMNS} from templates where id = ${id} and client_id = ${clientId}`.execute(db)
  ).rows[0];
}

/** Only `APPROVED` templates of the client's active accounts. Campaigns (M7) use only this. */
export async function listApprovedTemplates(db: Kysely<Database>, scope: { clientId: string }) {
  return (
    await sql<TemplateView>`
      select ${sql`t.id, t.name, t.language, t.category, t.components, t.variable_count as "variableCount"`}
      from templates t
      join wa_accounts a on a.id = t.wa_account_id and a.client_id = t.client_id
      where t.client_id = ${scope.clientId} and t.status = 'APPROVED' and a.status = 'active'
      order by t.name, t.language
    `.execute(db)
  ).rows;
}

export function registerTemplateRoutes(
  app: FastifyInstance,
  deps: {
    db: Kysely<Database>;
    now: () => Date;
    meta?: MetaClient;
    encryptionKey?: string;
    metaAppId: string;
    uploadDir: string;
  },
) {
  const { db, now, meta, encryptionKey, metaAppId, uploadDir } = deps;

  app.addContentTypeParser(Object.keys(MEDIA_TYPES), { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  // Stores the header's sample file and gets the handle Meta needs for review. The file is the request body.
  app.post('/api/clients/:clientId/templates/:id/media', async (req, reply) => {
    const { clientId } = req.scope!;
    const { id } = req.params as { id: string };
    const current = await readOne(db, clientId, id);
    if (!current) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    if (!meta || !encryptionKey || !metaAppId) {
      return sendError(reply, 503, 'NOT_CONFIGURED', 'File uploads are not set up on this server');
    }
    if (!EDITABLE.has(current.status)) {
      return sendError(reply, 409, 'NOT_EDITABLE', `A ${current.status} template cannot be edited`);
    }

    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    const rule = MEDIA_TYPES[type];
    const header = current.components.find((c) => c.type === 'HEADER');
    const bytes = req.body;
    if (!rule || !Buffer.isBuffer(bytes) || !header || header.format !== rule.format || bytes.length > rule.maxBytes || bytes.length === 0) {
      return sendError(reply, 400, 'FILE_NOT_ALLOWED', 'This file does not fit this template\'s header');
    }

    const account = (
      await sql<{ access_token_enc: Buffer }>`
        select access_token_enc from wa_accounts where id = ${current.waAccountId} and client_id = ${clientId}
      `.execute(db)
    ).rows[0]!;
    const token = decryptSecret(account.access_token_enc.toString('utf8'), encryptionKey);
    const uploaded = await meta.uploadSample(metaAppId, token, { name: `${id}.${rule.extension}`, type, bytes });
    if (!uploaded.ok || !uploaded.data.h) {
      return sendError(reply, 400, 'META_REFUSED', 'Meta refused this file');
    }

    const storageKey = path.join(clientId, `${id}.${rule.extension}`);
    await mkdir(path.join(uploadDir, clientId), { recursive: true });
    await writeFile(path.join(uploadDir, storageKey), bytes);

    const components = current.components.map((c) =>
      c.type === 'HEADER' ? { ...c, example: { header_handle: [uploaded.data.h!] } } : c,
    );
    const row = await sql<TemplateView>`
      update templates
      set components = ${JSON.stringify(components)}::jsonb, media_storage_key = ${storageKey}, status = 'DRAFT',
        validation_errors = null, updated_at = ${now()}
      where id = ${id} and client_id = ${clientId}
      returning ${COLUMNS}
    `.execute(db);
    return reply.code(200).send(view(row.rows[0]!));
  });
  const invalid = (reply: FastifyReply) =>
    sendError(reply, 400, 'INVALID_REQUEST', 'Send name, language, category and components');

  app.get('/api/clients/:clientId/templates', async (req, reply) => {
    const { clientId } = req.scope!;
    const rows = await sql<TemplateView>`
      select ${COLUMNS} from templates where client_id = ${clientId} order by updated_at desc, id limit 500
    `.execute(db);
    return reply.code(200).send({ items: rows.rows.map(view), nextCursor: null });
  });

  app.post('/api/clients/:clientId/templates', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const parsed = TemplateCreate.safeParse(req.body);
    if (!parsed.success) return invalid(reply);
    const { waAccountId, name, language, category, components } = parsed.data;

    const account = (
      await sql`select 1 from wa_accounts where id = ${waAccountId} and client_id = ${clientId}`.execute(db)
    ).rows[0];
    if (!account) return sendError(reply, 404, 'NOT_FOUND', 'Not found');

    try {
      const row = await sql<TemplateView>`
        insert into templates (client_id, wa_account_id, name, language, category, components, variable_count, status, created_by, updated_at)
        values (
          ${clientId}, ${waAccountId}, ${name}, ${language}, ${category}, ${JSON.stringify(components)}::jsonb,
          ${countVariables(components)}, 'DRAFT', ${userId}, ${now()}
        )
        returning ${COLUMNS}
      `.execute(db);
      return reply.code(201).send(view(row.rows[0]!));
    } catch (err) {
      if (isNameTaken(err)) return nameTaken(reply);
      throw err;
    }
  });

  app.get('/api/clients/:clientId/templates/:id', async (req, reply) => {
    const row = await readOne(db, req.scope!.clientId, (req.params as { id: string }).id);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    return reply.code(200).send(view(row));
  });

  app.put('/api/clients/:clientId/templates/:id', async (req, reply) => {
    const { clientId } = req.scope!;
    const { id } = req.params as { id: string };
    const current = await readOne(db, clientId, id);
    if (!current) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const parsed = TemplateEdit.safeParse(req.body);
    if (!parsed.success) return invalid(reply);
    const { name, language, category, components } = parsed.data;

    if (!EDITABLE.has(current.status)) {
      return sendError(reply, 409, 'NOT_EDITABLE', `A ${current.status} template cannot be edited; copy it into a new draft`);
    }
    // Meta cannot rename a template it already has.
    if (current.metaTemplateId && (name !== current.name || language !== current.language)) {
      return sendError(reply, 409, 'NAME_LOCKED', 'Meta already has this template, so its name and language cannot change');
    }

    try {
      const row = await sql<TemplateView>`
        update templates
        set name = ${name}, language = ${language}, category = ${category},
          components = ${JSON.stringify(components)}::jsonb, variable_count = ${countVariables(components)},
          status = 'DRAFT', validation_errors = null, rejection_reason = null, meta_recommendation = null,
          updated_at = ${now()}
        where id = ${id} and client_id = ${clientId} and status in ('DRAFT', 'VALIDATION_FAILED', 'REJECTED')
        returning ${COLUMNS}
      `.execute(db);
      if (!row.rows[0]) return sendError(reply, 409, 'NOT_EDITABLE', 'This template has just changed; reload it');
      return reply.code(200).send(view(row.rows[0]));
    } catch (err) {
      if (isNameTaken(err)) return nameTaken(reply);
      throw err;
    }
  });

  app.post('/api/clients/:clientId/templates/:id/submit', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const { id } = req.params as { id: string };
    const current = await readOne(db, clientId, id);
    if (!current) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    if (!SUBMITTABLE.has(current.status)) {
      return sendError(reply, 409, 'NOT_SUBMITTABLE', `A ${current.status} template cannot be submitted; edit it first`);
    }

    const setting = (
      await sql<{ value: string[] }>`select value from settings where key = 'promo_words'`.execute(db)
    ).rows[0];
    const failures = checkTemplate(current, { promoWords: setting?.value ?? [] });
    const at = now();

    const row =
      failures.length > 0
        ? await sql<TemplateView>`
            update templates set status = 'VALIDATION_FAILED', validation_errors = ${JSON.stringify(failures)}::jsonb, updated_at = ${at}
            where id = ${id} and client_id = ${clientId} and status in ('DRAFT', 'VALIDATION_FAILED')
            returning ${COLUMNS}
          `.execute(db)
        : await sql<TemplateView>`
            update templates
            set status = 'SUBMITTING', validation_errors = null, submitted_at = ${at}, submitted_by = ${userId}, updated_at = ${at}
            where id = ${id} and client_id = ${clientId} and status in ('DRAFT', 'VALIDATION_FAILED')
            returning ${COLUMNS}
          `.execute(db);
    if (!row.rows[0]) return sendError(reply, 409, 'NOT_SUBMITTABLE', 'This template has just changed; reload it');
    return reply.code(failures.length > 0 ? 422 : 202).send(view(row.rows[0]));
  });

  app.post('/api/clients/:clientId/templates/:id/copy', async (req, reply) => {
    const { clientId, userId } = req.scope!;
    const { id } = req.params as { id: string };
    const current = await readOne(db, clientId, id);
    if (!current) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const parsed = TemplateCopy.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send the new name');

    try {
      const row = await sql<TemplateView>`
        insert into templates (client_id, wa_account_id, name, language, category, components, variable_count, status, created_by, updated_at)
        values (
          ${clientId}, ${current.waAccountId}, ${parsed.data.name}, ${current.language}, ${current.category},
          ${JSON.stringify(current.components)}::jsonb, ${countVariables(current.components)}, 'DRAFT', ${userId}, ${now()}
        )
        returning ${COLUMNS}
      `.execute(db);
      return reply.code(201).send(view(row.rows[0]!));
    } catch (err) {
      if (isNameTaken(err)) return nameTaken(reply);
      throw err;
    }
  });
}
