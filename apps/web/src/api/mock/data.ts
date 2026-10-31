import type { UserRole, Workspace } from '@reaplift/shared';

/**
 * The M1 spec's worked example, the same people and clients `cli seed-dev` creates on the real
 * server, with the same password, so a screen behaves alike in mock and real mode.
 */
export const MOCK_PASSWORD = 'reaplift-dev-1';

export const mockClients: Workspace[] = [
  { clientId: 'client-bluebird', name: 'Bluebird Retail', status: 'active' },
  { clientId: 'client-greenleaf', name: 'Greenleaf Foods', status: 'active' },
  { clientId: 'client-northwind', name: 'Northwind Labs', status: 'active' },
];

export type MockUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** The client of a `client` user; null for staff and super admin. */
  clientId: string | null;
  /** The clients assigned to a `staff` user. */
  staffClientIds: string[];
};

export const mockUsers: MockUser[] = [
  { id: 'user-ravi', name: 'Ravi', email: 'ravi@reaplift.com', role: 'super_admin', clientId: null, staffClientIds: [] },
  {
    id: 'user-meera',
    name: 'Meera',
    email: 'meera@reaplift.com',
    role: 'staff',
    clientId: null,
    staffClientIds: ['client-northwind', 'client-bluebird'],
  },
  {
    id: 'user-northwind-ops',
    name: 'Northwind Ops',
    email: 'ops@northwind.com',
    role: 'client',
    clientId: 'client-northwind',
    staffClientIds: [],
  },
  {
    id: 'user-greenleaf-sales',
    name: 'Greenleaf Sales',
    email: 'sales@greenleaf.in',
    role: 'client',
    clientId: 'client-greenleaf',
    staffClientIds: [],
  },
];
