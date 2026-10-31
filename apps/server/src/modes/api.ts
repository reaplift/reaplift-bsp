import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { createDb, createPool, pingDb } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';

export async function runApi(config: Config, log: Logger) {
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const app = buildApp({
    version: config.APP_VERSION,
    logger: { level: config.LOG_LEVEL },
    checkDb: () => pingDb(db),
    db,
    panelOrigin: config.PANEL_ORIGIN,
    cookieSecure: config.SESSION_COOKIE_SECURE,
    metaVerifyToken: config.META_VERIFY_TOKEN,
    metaAppSecret: config.META_APP_SECRET,
  });

  const shutdown = async () => {
    log.info('shutting down');
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: '0.0.0.0', port: config.PORT });
  log.info({ port: config.PORT, version: config.APP_VERSION }, 'api listening');
}
