import type { Config } from '../config.js';
import type { Logger } from '../lib/logger.js';

/**
 * Minimal milestone 1 worker entrypoint: logs the queueing contract and exits.
 * The production loop can be added without changing the single-process model.
 */
export async function runWorker(_config: Config, log: Logger) {
  log.info('worker mode started; queue claiming contract is active');
}
