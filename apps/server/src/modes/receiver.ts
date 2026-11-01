import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { watchCampaigns } from '../modules/campaigns/monitor.js';
import { processEvents } from '../modules/messaging/processor.js';
import { runLoops } from './loops.js';

const PARALLEL_PROCESSORS = 4;

/** Turns the webhooks the API stored in `meta_events` into message statuses. */
export async function runReceiver(config: Config, log: Logger) {
  const db = createDb(createPool(config.DATABASE_URL));
  log.info({ loops: ['meta-events', 'campaign-watch'] }, 'receiver started');
  await runLoops(
    [
      // Meta sends about 3 webhooks per message, for every client at once, so this must outrun all the senders.
      // Several run side by side; each event is locked, so none is handled twice.
      {
        name: 'meta-events',
        everyMs: 100,
        run: () => Promise.all(Array.from({ length: PARALLEL_PROCESSORS }, () => processEvents(db, new Date(), log))),
      },
      { name: 'campaign-watch', everyMs: 5_000, run: () => watchCampaigns(db) },
    ],
    log,
  );
  await db.destroy();
  log.info('receiver stopped');
}
