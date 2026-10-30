import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { AdminClient, type HealthResponse } from '@reaplift/shared';
import type { Database } from './lib/db.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerScope } from './modules/auth/scope.js';

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
  logger?: boolean;
  /** The panel's address; state-changing requests from any other origin are refused. */
  panelOrigin?: string;
  /** Secure flag on the session cookie; off only for plain-http local development. */
  cookieSecure?: boolean;
  /** Clock, replaceable in tests (session expiry, lockout). */
  now?: () => Date;
  metaVerifyToken?: string;
  metaAppSecret?: string;
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
  const adminClients: Array<z.infer<typeof AdminClient>> = [
    {
      id: 'cli-seed-001',
      name: 'Northwind Labs',
      contactEmail: 'ops@northwind.com',
      assignedStaff: 'Aisha Shah',
      status: 'active',
      walletBalance: 120000,
    },
    {
      id: 'cli-seed-002',
      name: 'Bluebird Retail',
      contactEmail: 'sales@bluebird.in',
      assignedStaff: 'Rahul S',
      status: 'suspended',
      walletBalance: 25000,
    },
  ];
  registerScope(app, { db, now, panelOrigin });
  registerAuthRoutes(app, { db, now, cookieSecure });

  app.get('/healthz', async (_req, reply) => {
    const dbOk = await checkDb();
    const body: HealthResponse = {
      status: dbOk ? 'ok' : 'error',
      version,
      db: dbOk ? 'ok' : 'down',
    };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  // Admin routes below are M3's prototype on in-memory data; the scope hook allows only super admins.
  app.get('/api/admin/clients', async (_req, reply) => {
    return reply.code(200).send(adminClients);
  });

  app.post('/api/admin/clients', async (req, reply) => {
    const payload = req.body as unknown;
    const parsed = AdminClient.omit({ id: true }).safeParse(payload);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid client payload',
        details: parsed.error.flatten(),
      });
    }

    const nextClient = {
      ...parsed.data,
      id: `cli-${Date.now()}`,
    } satisfies z.infer<typeof AdminClient>;

    adminClients.unshift(nextClient);
    return reply.code(201).send(nextClient);
  });

  app.patch('/api/admin/clients/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string };
    const payload = req.body as { status?: string };
    const status = payload.status;

    if (status !== 'active' && status !== 'suspended') {
      return reply.code(400).send({ error: 'status must be active or suspended' });
    }

    const client = adminClients.find((entry) => entry.id === id);

    if (!client) {
      return reply.code(404).send({ error: 'client not found' });
    }

    client.status = status;
    return reply.code(200).send(client);
  });

  app.patch('/api/admin/clients/:id/staff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const payload = req.body as { assignedStaff?: string };
    const assignedStaff = payload.assignedStaff?.trim();

    if (!assignedStaff) {
      return reply.code(400).send({ error: 'assignedStaff is required' });
    }

    const client = adminClients.find((entry) => entry.id === id);

    if (!client) {
      return reply.code(404).send({ error: 'client not found' });
    }

    client.assignedStaff = assignedStaff;
    return reply.code(200).send(client);
  });

  app.get('/webhooks/meta', async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const mode = query['hub.mode'];
    const challenge = query['hub.challenge'];
    const verifyToken = query['hub.verify_token'];

    if (mode !== 'subscribe' || !challenge || verifyToken !== metaVerifyToken) {
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

    return reply.code(200).send({ ok: true });
  });

  return app;
}
