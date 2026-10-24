import { createHmac, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { HealthResponse, PingResponse } from '@reaplift/shared';

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
