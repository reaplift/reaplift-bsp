import { z } from 'zod';

/** Modes the single server image can start in. */
export const MODES = ['api', 'worker', 'receiver', 'scheduler', 'migrate'] as const;
export type Mode = (typeof MODES)[number];

/** Response of GET /healthz, shared by the server and the panel. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'error']),
  version: z.string(),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
