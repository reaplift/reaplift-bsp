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

/** Shared dashboard metrics used by the web app and future API responses. */
export const DashboardSummary = z.object({
  totalSent: z.number(),
  delivered: z.number(),
  readRate: z.number(),
  activeCampaigns: z.number(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

/** Shared campaign statuses used by the web app and future server responses. */
export const CampaignStatus = z.enum(['draft', 'scheduled', 'sending', 'sent', 'failed']);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

export const CampaignDraft = z.object({
  id: z.string(),
  name: z.string(),
  audience: z.string(),
  status: CampaignStatus,
  scheduledAt: z.string().nullable(),
  template: z.string(),
});
export type CampaignDraft = z.infer<typeof CampaignDraft>;
