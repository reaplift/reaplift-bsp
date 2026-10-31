import { z } from 'zod';
import { MODES } from '@reaplift/shared';

export const DEV_ENCRYPTION_KEY = '12345678901234567890123456789012';

export const META_API_URL = 'https://graph.facebook.com';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const Env = z.object({
  MODE: z.enum(MODES).default('api'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  META_VERIFY_TOKEN: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  /** Embedded Signup and template media uploads. */
  META_APP_ID: z.string().default(''),
  /** The system user's token and ReapLift's credit line; blank until E7, so new client accounts stay paused. */
  META_SYSTEM_TOKEN: z.string().default(''),
  META_CREDIT_LINE_ID: z.string().default(''),
  /** Where uploaded files go until object storage exists (M10). */
  UPLOAD_DIR: z.preprocess(blankToUndefined, z.string().default('./uploads')),
  /** Latest stable when M4 was built (checked 30 October 2026). */
  META_GRAPH_VERSION: z.preprocess(blankToUndefined, z.string().default('v26.0')),
  /** Only changed to point at the fake Meta server. */
  META_API_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default(META_API_URL)),
  /** The panel's address; state-changing requests must come from it. */
  PANEL_ORIGIN: z.preprocess(blankToUndefined, z.string().url().default('http://localhost:5173')),
  /** Secure flag on the session cookie. Blank means on; set `false` only for plain-http local development. */
  SESSION_COOKIE_SECURE: z
    .preprocess(blankToUndefined, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  /** M2 email: `fake` logs emails (development, tests); `smtp` sends through OCI Email Delivery. */
  EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(['fake', 'smtp']).default('fake')),
  /** Fake provider only: when set, every send fails with this message (to watch retries). */
  EMAIL_FAKE_FAIL: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(587)),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.preprocess(blankToUndefined, z.string().email().default('info@reaplift.com')),
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

/** The development key is public, so a real Meta token must not be stored with it. */
export function usesPublicKeyWithRealMeta(
  config: Pick<Config, 'META_API_BASE_URL' | 'APP_ENCRYPTION_KEY'>,
): boolean {
  return config.META_API_BASE_URL === META_API_URL && config.APP_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY;
}
