import { z } from 'zod';
import { MODES } from '@reaplift/shared';

const DEV_ENCRYPTION_KEY = '12345678901234567890123456789012';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const Env = z.object({
  MODE: z.enum(MODES).default('api'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  META_VERIFY_TOKEN: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  /** The panel's address; state-changing requests must come from it. */
  PANEL_ORIGIN: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:5173')),
  /** Secure flag on the session cookie. Blank means on; set `false` only for plain-http local development. */
  SESSION_COOKIE_SECURE: z
    .preprocess(blankToUndefined, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  APP_VERSION: z
    .string()
    .optional()
    .transform((v) => (v ? v : 'dev')),
  APP_ENCRYPTION_KEY: z.preprocess((value) => {
    if (typeof value === 'string') {
      return value.trim() || DEV_ENCRYPTION_KEY;
    }
    return value ?? DEV_ENCRYPTION_KEY;
  }, z.string().length(32)),
});

export type Config = z.infer<typeof Env>;

/** Reads settings from the environment. A `--mode=<mode>` argument overrides MODE. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv = process.argv): Config {
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length);
  return Env.parse({ ...env, ...(modeArg ? { MODE: modeArg } : {}) });
}
