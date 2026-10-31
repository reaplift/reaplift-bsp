import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { MetaClient } from '../lib/meta-client.js';
import { syncQuality } from '../modules/messaging/quality.js';
import { syncTemplateStatuses } from '../modules/templates/status.js';
import { runLoops } from './loops.js';

const TEMPLATE_SYNC_MS = 15 * 60 * 1000;
const QUALITY_SYNC_MS = 60 * 60 * 1000;

/** Catches what webhooks miss: template statuses every 15 minutes, quality and limit every hour. */
export async function runScheduler(config: Config, log: Logger) {
  const db = createDb(createPool(config.DATABASE_URL));
  const deps = {
    db,
    meta: new MetaClient({ baseUrl: config.META_API_BASE_URL, version: config.META_GRAPH_VERSION }),
    encryptionKey: config.APP_ENCRYPTION_KEY,
    log,
  };
  log.info({ loops: ['template-statuses', 'quality'] }, 'scheduler started');
  await runLoops(
    [
      { name: 'template-statuses', everyMs: TEMPLATE_SYNC_MS, run: () => syncTemplateStatuses(deps) },
      { name: 'quality', everyMs: QUALITY_SYNC_MS, run: () => syncQuality(deps) },
    ],
    log,
  );
  await db.destroy();
  log.info('scheduler stopped');
}
