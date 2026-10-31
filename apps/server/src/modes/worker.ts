import type { Config } from '../config.js';
import { createDb, createPool } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { MetaClient } from '../lib/meta-client.js';
import { AccountPacer, reportStuck, sendDue } from '../modules/messaging/sender.js';
import { deliverDue } from '../modules/notifications/delivery.js';
import { submitDue } from '../modules/templates/submission.js';
import {
  FakeEmailProvider,
  SmtpEmailProvider,
  type EmailProvider,
} from '../modules/notifications/email.js';
import { runLoops, type Loop } from './loops.js';

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
  const meta = new MetaClient({ baseUrl: config.META_API_BASE_URL, version: config.META_GRAPH_VERSION });
  const pacer = new AccountPacer();
  const loops: Loop[] = [
    { name: 'notifications', everyMs: 2_000, run: () => deliverDue(db, provider, new Date(), log) },
    {
      name: 'messages',
      everyMs: 100,
      run: () => sendDue({ db, meta, encryptionKey: config.APP_ENCRYPTION_KEY, pacer, log }),
    },
    {
      name: 'template-submissions',
      everyMs: 2_000,
      run: () => submitDue({ db, meta, encryptionKey: config.APP_ENCRYPTION_KEY, log }),
    },
    { name: 'stuck-messages', everyMs: 60_000, run: () => reportStuck(db, log) },
  ];

  log.info(
    { loops: loops.map((l) => l.name), emailProvider: config.EMAIL_PROVIDER },
    'worker started',
  );
  await runLoops(loops, log);
  await db.destroy();
  log.info('worker stopped');
}
