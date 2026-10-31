import { buildApp } from '../app.js';
import { usesPublicKeyWithRealMeta, type Config } from '../config.js';
import { createDb, createPool, pingDb } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { MetaClient } from '../lib/meta-client.js';

export async function runApi(config: Config, log: Logger) {
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const app = buildApp({
    version: config.APP_VERSION,
    logger: {
      level: config.LOG_LEVEL,
      // Meta's webhook check carries the verify token in the query string, so it stays out of the log.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.split('?')[0], remoteAddress: req.ip }),
      },
    },
    checkDb: () => pingDb(db),
    db,
    panelOrigin: config.PANEL_ORIGIN,
    cookieSecure: config.SESSION_COOKIE_SECURE,
    metaVerifyToken: config.META_VERIFY_TOKEN,
    metaAppSecret: config.META_APP_SECRET,
    metaAppId: config.META_APP_ID,
    metaSystemToken: config.META_SYSTEM_TOKEN,
    metaCreditLineId: config.META_CREDIT_LINE_ID,
    uploadDir: config.UPLOAD_DIR,
    // The development key is public, so a real Meta token must not be stored with it.
    ...(usesPublicKeyWithRealMeta(config)
      ? {}
      : {
          meta: new MetaClient({ baseUrl: config.META_API_BASE_URL, version: config.META_GRAPH_VERSION }),
          encryptionKey: config.APP_ENCRYPTION_KEY,
        }),
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
