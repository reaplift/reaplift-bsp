import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { watchCampaigns } from '../modules/campaigns/monitor.js';
import { processEvents } from '../modules/messaging/processor.js';
import { runLoops } from './loops.js';

/** Turns the webhooks the API stored in `meta_events` into message statuses. */
export async function runReceiver(config: Config, log: Logger) {
  const db = createDb(createPool(config.DATABASE_URL));
  log.info({ loops: ['meta-events', 'campaign-watch'] }, 'receiver started');
  await runLoops(
    [
      { name: 'meta-events', everyMs: 500, run: () => processEvents(db, new Date(), log) },
      { name: 'campaign-watch', everyMs: 5_000, run: () => watchCampaigns(db) },
    ],
    log,
  );
  await db.destroy();
  log.info('receiver stopped');
}
