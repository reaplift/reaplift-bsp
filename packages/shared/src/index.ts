import { z } from 'zod';

/** Modes the single server image can start in. */
export const MODES = ['api', 'worker', 'receiver', 'scheduler', 'migrate'] as const;
export type Mode = (typeof MODES)[number];

export const USER_ROLES = ['super_admin', 'client_admin', 'staff'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type AppPageId = 'dashboard' | 'campaign' | 'lists' | 'admin' | 'login';

export function canAccessPage(role: UserRole | null | undefined, page: AppPageId): boolean {
  if (page === 'login') return true;
  if (!role) return false;

  if (role === 'super_admin') return true;
  if (role === 'staff') return page === 'dashboard' || page === 'campaign';

  return page === 'dashboard' || page === 'campaign';
}

export function canManageClients(role: UserRole | null | undefined): boolean {
  return role === 'super_admin';
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

/** Error body of the milestone 4 routes onward. */
export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

/** File types a list can be uploaded as. Old binary .xls is not read: save as .xlsx. */
export const LIST_FILE_EXTENSIONS = ['csv', 'xlsx'] as const;

export const CreateListUploadRequest = z.object({
  clientId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type CreateListUploadRequest = z.infer<typeof CreateListUploadRequest>;

export const CreateListUploadResponse = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  expiresAt: z.string(),
  maxBytes: z.number(),
});
export type CreateListUploadResponse = z.infer<typeof CreateListUploadResponse>;

export const ImportListRequest = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  /** Leave out to detect the header row; 0 means the sheet has no header row. */
  headerRow: z.number().int().min(0).optional(),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('upload'), uploadId: z.string().min(1) }),
    z.object({ type: z.literal('google_sheet'), url: z.string().trim().min(1).max(2000) }),
  ]),
});
export type ImportListRequest = z.infer<typeof ImportListRequest>;

export const ListSummary = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  source: z.enum(['upload', 'google_sheet']),
  fileName: z.string(),
  sourceUrl: z.string().nullable(),
  columns: z.array(z.string()),
  headerRow: z.number().nullable(),
  totalRows: z.number(),
  blankRowsSkipped: z.number(),
  sizeBytes: z.number(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type ListSummary = z.infer<typeof ListSummary>;

export const ListContactRow = z.object({ rowNumber: z.number(), cells: z.array(z.string()) });
export type ListContactRow = z.infer<typeof ListContactRow>;

export const ListDetail = ListSummary.extend({ preview: z.array(ListContactRow) });
export type ListDetail = z.infer<typeof ListDetail>;

export const ClientOption = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'suspended']),
});
export type ClientOption = z.infer<typeof ClientOption>;
