import { z } from 'zod';

/** Modes the single server image can start in. */
export const MODES = ['api', 'worker', 'receiver', 'scheduler', 'migrate'] as const;
export type Mode = (typeof MODES)[number];

export const USER_ROLES = ['super_admin', 'client_admin', 'staff'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type AppPageId = 'dashboard' | 'campaign' | 'admin' | 'login';

export function canAccessPage(role: UserRole | null | undefined, page: AppPageId): boolean {
  if (page === 'login') return true;
  if (!role) return false;

  if (role === 'super_admin') return true;
  if (role === 'staff') return page === 'dashboard' || page === 'campaign';

  return page === 'dashboard' || page === 'campaign';
}

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

export const AdminClient = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended']),
  contactEmail: z.string().nullable(),
  walletBalance: z.number(),
  assignedStaff: z.string(),
});
export type AdminClient = z.infer<typeof AdminClient>;

export const TeamMember = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['super_admin', 'staff', 'client']),
  email: z.string(),
  clientCount: z.number(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const PingResponse = z.object({
  message: z.string(),
  source: z.enum(['backend']),
});
export type PingResponse = z.infer<typeof PingResponse>;
