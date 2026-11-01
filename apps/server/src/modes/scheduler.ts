import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { MetaClient } from '../lib/meta-client.js';
import { startDueCampaigns } from '../modules/campaigns/controls.js';
import { syncQuality } from '../modules/messaging/quality.js';
import { checkCreditLine, refreshDailyStats } from '../modules/reports/stats.js';
import { syncTemplateStatuses } from '../modules/templates/status.js';
import { checkLedgers } from '../modules/wallet/ledger.js';
import { runLoops } from './loops.js';

const TEMPLATE_SYNC_MS = 15 * 60 * 1000;
const QUALITY_SYNC_MS = 60 * 60 * 1000;
const LEDGER_CHECK_MS = 24 * 60 * 60 * 1000;
const SCHEDULED_CAMPAIGNS_MS = 60 * 1000;
const DAILY_STATS_MS = 5 * 60 * 1000;
const CREDIT_LINE_MS = 60 * 60 * 1000;

/** Catches what webhooks miss: template statuses every 15 minutes, quality and limit every hour. */
export async function runScheduler(config: Config, log: Logger) {
  const db = createDb(createPool(config.DATABASE_URL));
  const deps = {
    db,
    meta: new MetaClient({ baseUrl: config.META_API_BASE_URL, version: config.META_GRAPH_VERSION }),
    encryptionKey: config.APP_ENCRYPTION_KEY,
    log,
  };
  log.info({ loops: ['template-statuses', 'quality', 'ledger-check', 'scheduled-campaigns', 'daily-stats', 'credit-line'] }, 'scheduler started');
  await runLoops(
    [
      { name: 'template-statuses', everyMs: TEMPLATE_SYNC_MS, run: () => syncTemplateStatuses(deps) },
      { name: 'quality', everyMs: QUALITY_SYNC_MS, run: () => syncQuality(deps) },
      { name: 'ledger-check', everyMs: LEDGER_CHECK_MS, run: () => checkLedgers(db, new Date(), log) },
      { name: 'scheduled-campaigns', everyMs: SCHEDULED_CAMPAIGNS_MS, run: () => startDueCampaigns(db, new Date(), log) },
      { name: 'daily-stats', everyMs: DAILY_STATS_MS, run: () => refreshDailyStats(db) },
      { name: 'credit-line', everyMs: CREDIT_LINE_MS, run: () => checkCreditLine(db, new Date(), log) },
    ],
    log,
  );
  await db.destroy();
  log.info('scheduler stopped');
}
