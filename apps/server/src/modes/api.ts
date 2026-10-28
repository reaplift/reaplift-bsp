import path from 'node:path';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { createDb, createPool, pingDb } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { LocalDiskStorage } from '../modules/lists/storage.js';

export async function runApi(config: Config, log: Logger) {
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  const uploadDir = path.resolve(config.UPLOAD_DIR);
  const app = buildApp({
    version: config.APP_VERSION,
    checkDb: () => pingDb(db),
    lists: {
      db,
      storage: new LocalDiskStorage(uploadDir),
      uploadSigningSecret: config.UPLOAD_SIGNING_SECRET,
      uploadMaxBytes: config.UPLOAD_MAX_BYTES,
      listMaxRows: config.LIST_MAX_ROWS,
    },
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
  log.info({ port: config.PORT, version: config.APP_VERSION, uploadDir }, 'api listening');
}
