import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { runApi } from './modes/api.js';
import { runMigrate } from './modes/migrate.js';
import { runScheduler } from './modes/scheduler.js';
import { runReceiver } from './modes/receiver.js';
import { runWorker } from './modes/worker.js';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);

switch (config.MODE) {
  case 'api':
    await runApi(config, log);
    break;
  case 'migrate':
    await runMigrate(config, log);
    break;
  case 'worker':
    await runWorker(config, log);
    break;
  case 'receiver':
    await runReceiver(config, log);
    break;
  case 'scheduler':
    await runScheduler(config, log);
    break;
}
