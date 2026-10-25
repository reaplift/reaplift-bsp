import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { AdminClient, type HealthResponse, type PingResponse, type UserRole } from '@reaplift/shared';
import { createSessionToken } from './lib/auth.js';

export interface AppDeps {
  version: string;
  checkDb: () => Promise<boolean>;
  logger?: boolean;
  metaVerifyToken?: string;
  metaAppSecret?: string;
}

/** Builds the HTTP app. Dependencies are passed in so tests can replace them. */
export function buildApp({
  version,
  checkDb,
  logger = false,
  metaVerifyToken = '',
  metaAppSecret = '',
}: AppDeps) {
  const app = Fastify({ logger, rawBody: true });
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
  const demoUsers = {
    'admin@reaplift.ai': { password: 'password123', role: 'super_admin' as const },
    'client@reaplift.ai': { password: 'password123', role: 'client_admin' as const },
    'staff@reaplift.ai': { password: 'password123', role: 'staff' as const },
  } as const;
  const sessionStore = new Map<string, { email: string; role: UserRole; expiresAt: Date }>();

  const requireSession = (authorizationHeader: string | undefined) => {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      return null;
    }

    const token = authorizationHeader.slice('Bearer '.length).trim();
    const session = sessionStore.get(token);

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return session;
  };

  app.get('/healthz', async (_req, reply) => {
    const dbOk = await checkDb();
    const body: HealthResponse = {
      status: dbOk ? 'ok' : 'error',
      version,
      db: dbOk ? 'ok' : 'down',
    };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  app.get('/api/ping', async (_req, reply) => {
    const body: PingResponse = {
      message: 'I am backend. Hello from the server.',
      source: 'backend',
    };
    return reply.code(200).send(body);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const payload = req.body as { email?: string; password?: string; role?: string };
    const email = payload.email?.trim().toLowerCase();
    const password = payload.password;
    const role = payload.role as UserRole | undefined;

    if (!email || !password || !role) {
      return reply.code(400).send({ error: 'email, password and role are required' });
    }

    const user = demoUsers[email as keyof typeof demoUsers];
    if (!user || user.password !== password || user.role !== role) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const token = createSessionToken();
    sessionStore.set(token, {
      email,
      role,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });

    return reply.code(200).send({
      ok: true,
      user: { email, role },
      token,
    });
  });

  const requireAdminSession = (req: Parameters<typeof app.get>[0] extends never ? never : any) => {
    const session = requireSession(req.headers.authorization as string | undefined);
    if (!session) {
      return null;
    }
    return session.role === 'super_admin' ? session : null;
  };

  app.get('/api/admin/clients', async (req, reply) => {
    const session = requireAdminSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.code(200).send(adminClients);
  });

  app.post('/api/admin/clients', async (req, reply) => {
    const session = requireAdminSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

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
    const session = requireAdminSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

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
    const session = requireAdminSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

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
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!metaAppSecret || !signature || !signature.startsWith('sha256=')) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const expected = createHmac('sha256', metaAppSecret).update(rawBody, 'utf8').digest('hex');
    const received = signature.slice('sha256='.length);
    const expectedBuf = Buffer.from(`sha256=${expected}`);
    const receivedBuf = Buffer.from(signature);

    if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    return reply.code(200).send({ ok: true });
  });

  return app;
}
