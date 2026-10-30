import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { deliverDue } from '../modules/notifications/delivery.js';
import {
  FakeEmailProvider,
  SmtpEmailProvider,
  type EmailProvider,
} from '../modules/notifications/email.js';

/** Background loops the worker runs. M4's message sending is added here as another loop. */
interface Loop {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

export function createEmailProvider(config: Config, log: Logger): EmailProvider {
  if (config.EMAIL_PROVIDER === 'fake')
    return new FakeEmailProvider(log, config.EMAIL_FAKE_FAIL || null);
  const missing = (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'] as const).filter((k) => !config[k]);
  if (missing.length) throw new Error(`EMAIL_PROVIDER=smtp needs ${missing.join(', ')}`);
  return new SmtpEmailProvider({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.EMAIL_FROM,
  });
}

export async function runWorker(config: Config, log: Logger) {
  const db = createDb(createPool(config.DATABASE_URL));
  const provider = createEmailProvider(config, log);
  const loops: Loop[] = [
    { name: 'notifications', everyMs: 2_000, run: () => deliverDue(db, provider, new Date(), log) },
  ];

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  log.info(
    { loops: loops.map((l) => l.name), emailProvider: config.EMAIL_PROVIDER },
    'worker started',
  );

  // Each loop waits for its own run to finish before the next, so one loop never overlaps itself.
  await Promise.all(
    loops.map(async (loop) => {
      while (!stopping) {
        try {
          await loop.run();
        } catch (err) {
          log.error({ loop: loop.name, err }, 'loop run failed; trying again next tick');
        }
        await new Promise((resolve) => setTimeout(resolve, loop.everyMs));
      }
    }),
  );
  await db.destroy();
  log.info('worker stopped');
}
