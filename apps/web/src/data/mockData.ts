import type { AdminClient, CampaignDraft, DashboardSummary, TeamMember } from '@reaplift/shared';

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

export const adminClients: AdminClient[] = [
  {
    id: 'cli-001',
    name: 'Sparkle Retail',
    status: 'active',
    contactEmail: 'ops@sparkleretail.in',
    walletBalance: 460000,
    assignedStaff: 'Aisha Shah',
  },
  {
    id: 'cli-002',
    name: 'Aarav Finance',
    status: 'active',
    contactEmail: 'marketing@aaravfinance.com',
    walletBalance: 240000,
    assignedStaff: 'Rahul S',
  },
  {
    id: 'cli-003',
    name: 'Urban Nest',
    status: 'suspended',
    contactEmail: null,
    walletBalance: 95000,
    assignedStaff: 'Mira Nair',
  },
];

export const teamMembers: TeamMember[] = [
  {
    id: 'usr-001',
    name: 'Aisha Shah',
    role: 'super_admin',
    email: 'aisha@reaplift.ai',
    clientCount: 3,
  },
  {
    id: 'usr-002',
    name: 'Rahul S.',
    role: 'staff',
    email: 'rahul@reaplift.ai',
    clientCount: 2,
  },
  {
    id: 'usr-003',
    name: 'Mira Nair',
    role: 'staff',
    email: 'mira@reaplift.ai',
    clientCount: 1,
  },
];
