import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { HealthResponse } from '@reaplift/shared';
import type { Database } from './lib/db.js';
import { registerMeRoutes } from './modules/admin/me-routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerScope } from './modules/auth/scope.js';
import { registerAccountRoutes } from './modules/messaging/account-routes.js';
import { registerTemplateRoutes } from './modules/templates/routes.js';
import { registerWalletRoutes } from './modules/wallet/routes.js';
import type { MetaClient } from './lib/meta-client.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Exact JSON body as received; Meta signs these bytes. */
    rawBody?: string;
  }
  interface FastifyInstance {
    /** Every route registered, so the route-walking test can check each one's access rule. */
    routeList: Array<{ method: string; url: string }>;
  }
}

export interface AppDeps {
  version: string;
  checkDb: () => Promise<boolean>;
  db: Kysely<Database>;
  logger?: FastifyServerOptions['logger'];
  /** The panel's address; state-changing requests from any other origin are refused. */
  panelOrigin?: string;
  /** Secure flag on the session cookie; off only for plain-http local development. */
  cookieSecure?: boolean;
  /** Clock, replaceable in tests (session expiry, lockout). */
  now?: () => Date;
  metaVerifyToken?: string;
  metaAppSecret?: string;
  /** Connecting a number calls Meta and stores its token encrypted; without these it answers 503. */
  meta?: MetaClient;
  encryptionKey?: string;
  metaAppId?: string;
  metaSystemToken?: string;
  metaCreditLineId?: string;
  uploadDir?: string;
}

/** Builds the HTTP app. Dependencies are passed in so tests can replace them. */
export function buildApp({
  version,
  checkDb,
  db,
  logger = false,
  panelOrigin = 'http://localhost:5173',
  cookieSecure = true,
  now = () => new Date(),
  metaVerifyToken = '',
  metaAppSecret = '',
  meta,
  encryptionKey,
  metaAppId = '',
  metaSystemToken = '',
  metaCreditLineId = '',
  uploadDir = './uploads',
}: AppDeps) {
  const app = Fastify({ logger });
  app.decorate('routeList', []);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') app.routeList.push({ method, url: route.url });
    }
  });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
  registerScope(app, { db, now, panelOrigin });
  registerAuthRoutes(app, { db, now, cookieSecure });
  registerAdminRoutes(app, { db, now, panelOrigin });
  registerMeRoutes(app, { db, now });
  registerWalletRoutes(app, { db, now });
  registerAccountRoutes(app, {
    db,
    now,
    meta,
    encryptionKey,
    metaAppId,
    metaAppSecret,
    metaSystemToken,
    metaCreditLineId,
  });
  registerTemplateRoutes(app, { db, now, meta, encryptionKey, metaAppId, uploadDir });

  app.get('/healthz', async (_req, reply) => {
    const dbOk = await checkDb();
    const body: HealthResponse = {
      status: dbOk ? 'ok' : 'error',
      version,
      db: dbOk ? 'ok' : 'down',
    };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  app.get('/webhooks/meta', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const challenge = query['hub.challenge'];
    const verifyToken = query['hub.verify_token'];

    if (mode !== 'subscribe' || !challenge || !metaVerifyToken || verifyToken !== metaVerifyToken) {
      return reply.code(403).send({ error: 'invalid verify token' });
    }

    return reply.code(200).send(challenge);
  });

  app.post('/webhooks/meta', async (req, reply) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!metaAppSecret || !signature || !signature.startsWith('sha256=')) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const expected = createHmac('sha256', metaAppSecret).update(rawBody, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(`sha256=${expected}`);
    const receivedBuf = Buffer.from(signature);

    if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    // Only store: no other work here, so Meta never times out. The processor does the rest.
    await sql`insert into meta_events (body) values (${rawBody}::jsonb)`.execute(db);
    return reply.code(200).send({ ok: true });
  });

  return app;
}
