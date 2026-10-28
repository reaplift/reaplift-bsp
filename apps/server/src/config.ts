import { z } from 'zod';
import { MODES } from '@reaplift/shared';

const DEV_ENCRYPTION_KEY = '12345678901234567890123456789012';
const DEV_UPLOAD_SIGNING_SECRET = 'dev-upload-signing-secret';

/** `.env.example` lists every setting with a blank value; blank means "use the default". */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const Env = z.object({
  MODE: z.enum(MODES).default('api'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  META_VERIFY_TOKEN: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
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
  UPLOAD_DIR: z.string().default('var/uploads').transform((v) => v.trim() || 'var/uploads'),
  UPLOAD_SIGNING_SECRET: z
    .string()
    .optional()
    .transform((v) => v?.trim() || DEV_UPLOAD_SIGNING_SECRET),
  UPLOAD_MAX_BYTES: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(50 * 1024 * 1024)),
  LIST_MAX_ROWS: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(200_000)),
});

export type Config = z.infer<typeof Env>;

/** Reads settings from the environment. A `--mode=<mode>` argument overrides MODE. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv = process.argv): Config {
  const modeArg = argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length);
  return Env.parse({ ...env, ...(modeArg ? { MODE: modeArg } : {}) });
}
