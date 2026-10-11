import type { Mode } from '@reaplift/shared';
import type { Logger } from '../lib/logger.js';

/** Placeholder for modes that arrive in later milestones. */
export async function runNotBuiltYet(mode: Mode, milestone: number, log: Logger) {
  log.warn({ mode }, `mode "${mode}" arrives in milestone ${milestone}; exiting`);
}
