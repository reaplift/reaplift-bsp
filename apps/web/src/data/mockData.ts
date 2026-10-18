import type { CampaignDraft, DashboardSummary } from '@reaplift/shared';

export const dashboardSummary: DashboardSummary = {
  totalSent: 14500,
  delivered: 13880,
  readRate: 68,
  activeCampaigns: 12,
};

export const campaigns: CampaignDraft[] = [
  {
    id: 'cmp-001',
    name: 'Welcome sequence',
    audience: 'New leads',
    status: 'sent',
    scheduledAt: '2026-10-18T09:00:00.000Z',
    template: 'welcome_template',
  },
  {
    id: 'cmp-002',
    name: 'Recharge reminder',
    audience: 'Active users',
    status: 'scheduled',
    scheduledAt: '2026-10-18T18:30:00.000Z',
    template: 'recharge_reminder',
  },
  {
    id: 'cmp-003',
    name: 'Weekend offer',
    audience: 'VIP list',
    status: 'draft',
    scheduledAt: null,
    template: 'weekend_offer',
  },
];
