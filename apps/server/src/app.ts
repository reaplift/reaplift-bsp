import Fastify from 'fastify';
import type { HealthResponse } from '@reaplift/shared';

export interface AppDeps {
  version: string;
  checkDb: () => Promise<boolean>;
  logger?: boolean;
}

/** Builds the HTTP app. Dependencies are passed in so tests can replace them. */
export function buildApp({ version, checkDb, logger = false }: AppDeps) {
  const app = Fastify({ logger });

  app.get('/healthz', async (_req, reply) => {
    const dbOk = await checkDb();
    const body: HealthResponse = {
      status: dbOk ? 'ok' : 'error',
      version,
      db: dbOk ? 'ok' : 'down',
    };
    return reply.code(dbOk ? 200 : 503).send(body);
  });

  return app;
}
