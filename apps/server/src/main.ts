import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { runApi } from './modes/api.js';
import { runMigrate } from './modes/migrate.js';
import { runNotBuiltYet } from './modes/not-built-yet.js';

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
  case 'receiver':
    await runNotBuiltYet(config.MODE, 1, log);
    break;
  case 'scheduler':
    await runNotBuiltYet(config.MODE, 3, log);
    break;
}
