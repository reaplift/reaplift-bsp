import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  CreateListUploadRequest,
  ImportListRequest,
  LIST_FILE_EXTENSIONS,
  type CreateListUploadResponse,
  type UserRole,
} from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { ListError } from './errors.js';
import { downloadSheetCsv } from './google-sheet.js';
import { findClient, getList, importList, listClients, listLists } from './service.js';
import { checkUploadSignature, signUploadUrl } from './signed-link.js';
import { listFileKey, type FileStorage } from './storage.js';

const UPLOAD_LINK_SECONDS = 15 * 60;
const UPLOAD_ID_PATTERN = /^[0-9a-f-]{36}\.(csv|xlsx)$/;

export interface ListRoutesDeps {
  db: Kysely<Database>;
  storage: FileStorage;
  uploadSigningSecret: string;
  uploadMaxBytes: number;
  listMaxRows: number;
  /** Replaced in tests so Google Sheets is never called for real. */
  fetch?: typeof fetch;
  getSession: (req: FastifyRequest) => { email: string; role: UserRole } | null;
}

const ClientQuery = z.object({ clientId: z.string().uuid() });
const ListParams = z.object({ id: z.string().uuid() });
const UploadParams = z.object({ uploadId: z.string().regex(UPLOAD_ID_PATTERN) });
const UploadQuery = z.object({
  clientId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  expires: z.coerce.number().int(),
  sig: z.string().min(1),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.');
    throw new ListError(
      400,
      'INVALID_REQUEST',
      where ? `${where}: ${issue?.message}` : (issue?.message ?? 'Invalid request.'),
    );
  }
  return result.data;
}

const extensionOf = (fileName: string) => /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';

/**
 * Task 4.1: upload a CSV or Excel file, or read a Google Sheet, into `lists` and `list_contacts`.
 * Contract: docs/milestones/m4-lists-and-campaign-draft/backend-api.md.
 */
export async function listRoutes(app: FastifyInstance, deps: ListRoutesDeps) {
  const { db, storage } = deps;

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ListError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ error: 'INVALID_REQUEST', message: message ?? 'Invalid request.' });
    }
    req.log.error({ err }, 'list request failed');
    return reply
      .code(500)
      .send({ error: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' });
  });

  /** Super users only until M2.2 attaches a client to each session. Returns the session. */
  const requireSuperAdmin = (req: FastifyRequest) => {
    const session = deps.getSession(req);
    if (!session) throw new ListError(401, 'UNAUTHORIZED', 'Log in again.');
    if (session.role !== 'super_admin') {
      throw new ListError(403, 'FORBIDDEN', 'Only a ReapLift super user can manage lists for now.');
    }
    return session;
  };

  const requireClient = async (clientId: string) => {
    if (!(await findClient(db, clientId)))
      throw new ListError(404, 'CLIENT_NOT_FOUND', 'No client with this ID.');
  };

  app.get('/api/clients', async (req) => {
    requireSuperAdmin(req);
    return { clients: await listClients(db) };
  });

  app.post('/api/lists/uploads', async (req, reply) => {
    requireSuperAdmin(req);
    const body = parse(CreateListUploadRequest, req.body);
    const ext = extensionOf(body.fileName);
    if (!(LIST_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ListError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        'Only .csv and .xlsx files can be uploaded. Save the file as .xlsx or .csv and upload again.',
      );
    }
    if (body.sizeBytes > deps.uploadMaxBytes) {
      throw new ListError(
        413,
        'FILE_TOO_LARGE',
        `Files can be at most ${deps.uploadMaxBytes} bytes.`,
      );
    }
    await requireClient(body.clientId);

    const uploadId = `${randomUUID()}.${ext}`;
    const expires = Math.floor(Date.now() / 1000) + UPLOAD_LINK_SECONDS;
    const grant = { clientId: body.clientId, uploadId, fileName: body.fileName, expires };
    const response: CreateListUploadResponse = {
      uploadId,
      uploadUrl: signUploadUrl(grant, deps.uploadSigningSecret),
      expiresAt: new Date(expires * 1000).toISOString(),
      maxBytes: deps.uploadMaxBytes,
    };
    return reply.code(201).send(response);
  });

  // The file bytes. The signed link is the permission; the body is streamed to storage unparsed.
  await app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, _payload, done) => done(null));

    raw.put('/api/lists/uploads/:uploadId', async (req) => {
      const query = req.query as Record<string, unknown>;
      const { uploadId } = parse(UploadParams, req.params);
      const grant = parse(UploadQuery, query);

      const check = checkUploadSignature(
        { ...grant, uploadId },
        grant.sig,
        deps.uploadSigningSecret,
      );
      if (check === 'invalid')
        throw new ListError(403, 'INVALID_SIGNATURE', 'This upload link is not valid.');
      if (check === 'expired')
        throw new ListError(
          410,
          'LINK_EXPIRED',
          'This upload link has expired. Start the upload again.',
        );

      const stored = await storage.put(
        listFileKey(grant.clientId, uploadId),
        req.raw,
        deps.uploadMaxBytes,
        grant.fileName,
      );
      return { uploadId, bytes: stored.bytes };
    });
  });

  app.post('/api/lists/import', async (req, reply) => {
    const session = requireSuperAdmin(req);
    const body = parse(ImportListRequest, req.body);
    await requireClient(body.clientId);

    let storageKey: string;
    let fileName: string;
    let sizeBytes: number;
    let sourceUrl: string | null = null;

    if (body.source.type === 'upload') {
      if (!UPLOAD_ID_PATTERN.test(body.source.uploadId)) {
        throw new ListError(404, 'UPLOAD_NOT_FOUND', 'No uploaded file with this ID.');
      }
      storageKey = listFileKey(body.clientId, body.source.uploadId);
      const stored = await storage.stat(storageKey);
      if (!stored) throw new ListError(404, 'UPLOAD_NOT_FOUND', 'No uploaded file with this ID.');
      fileName = stored.fileName;
      sizeBytes = stored.bytes;
    } else {
      // Keep a copy of exactly what was downloaded, so the list can be traced to its data.
      const sheet = await downloadSheetCsv(body.source.url, deps.fetch);
      storageKey = listFileKey(body.clientId, `${randomUUID()}.csv`);
      try {
        const stored = await storage.put(
          storageKey,
          sheet.body,
          deps.uploadMaxBytes,
          sheet.fileName,
        );
        fileName = stored.fileName;
        sizeBytes = stored.bytes;
      } catch (err) {
        if (err instanceof ListError) throw err;
        throw new ListError(
          502,
          'SHEET_FETCH_FAILED',
          'The download from Google Sheets stopped part way. Try again.',
        );
      }
      sourceUrl = body.source.url;
    }

    const list = await importList(
      db,
      storage,
      {
        clientId: body.clientId,
        name: body.name,
        createdBy: session.email,
        source: body.source.type,
        sourceUrl,
        storageKey,
        fileName,
        sizeBytes,
        headerRow: body.headerRow,
      },
      deps.listMaxRows,
    );
    return reply.code(201).send(list);
  });

  app.get('/api/lists', async (req) => {
    requireSuperAdmin(req);
    const { clientId } = parse(ClientQuery, req.query);
    await requireClient(clientId);
    return { lists: await listLists(db, clientId) };
  });

  app.get('/api/lists/:id', async (req) => {
    requireSuperAdmin(req);
    const { clientId } = parse(ClientQuery, req.query);
    const { id } = parse(ListParams, req.params);
    await requireClient(clientId);
    const list = await getList(db, clientId, id);
    if (!list) throw new ListError(404, 'LIST_NOT_FOUND', 'No list with this ID for this client.');
    return list;
  });
}
