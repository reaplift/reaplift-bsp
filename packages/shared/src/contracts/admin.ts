import { z } from 'zod';

const Email = z.string().trim().toLowerCase().email();

/** India is the only country at launch. */
export const ClientCreate = z
  .object({ name: z.string().trim().min(1), countryCallingCode: z.enum(['91']), contactEmail: Email })
  .strict();

export const ClientEdit = z
  .object({ name: z.string().trim().min(1).optional(), contactEmail: Email.optional() })
  .strict()
  .refine((body) => body.name !== undefined || body.contactEmail !== undefined);

export const StatusNote = z.object({ note: z.string().trim().min(1) }).strict();

export const UserCreate = z
  .object({
    name: z.string().trim().min(1),
    email: Email,
    role: z.enum(['client', 'staff']),
    clientId: z.string().uuid().optional(),
    password: z.string().min(10),
    clientIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

export const UserStatus = z.object({ status: z.enum(['active', 'disabled']) }).strict();

export const ResetPassword = z.object({ password: z.string().min(10) }).strict();

export const StaffClients = z.object({ clientIds: z.array(z.string().uuid()) }).strict();

export const ChangePassword = z
  .object({ currentPassword: z.string().min(1), newPassword: z.string().min(10) })
  .strict();

// Responses. Not strict, so a field the server adds later does not break the panel.
const ClientStatus = z.enum(['active', 'suspended']);

export const AdminClient = z.object({
  id: z.string(),
  name: z.string(),
  status: ClientStatus,
  countryCallingCode: z.string().nullable(),
  contactEmail: z.string().nullable(),
  lowBalanceAlertPaise: z.number().nullable(),
  balancePaise: z.number().optional(),
  onHoldPaise: z.number().optional(),
});
export type AdminClient = z.infer<typeof AdminClient>;

export const AdminClientList = z.object({ items: z.array(AdminClient), nextCursor: z.string().nullable() });

const PersonStatus = z.enum(['active', 'disabled']);

export const AdminClientDetail = AdminClient.extend({
  users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), status: PersonStatus })),
  staff: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), status: PersonStatus })),
});
export type AdminClientDetail = z.infer<typeof AdminClientDetail>;

export const AdminUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: PersonStatus,
  clientId: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  assignedClientIds: z.array(z.string()),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserList = z.object({ items: z.array(AdminUser), nextCursor: z.string().nullable() });

export const AuditRow = z.object({
  id: z.number(),
  clientId: z.string().nullable(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditRow = z.infer<typeof AuditRow>;

export const AuditPage = z.object({ items: z.array(AuditRow), nextCursor: z.string().nullable() });

export const MyNotification = z.object({
  id: z.string(),
  event: z.string(),
  subject: z.string(),
  text: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MyNotification = z.infer<typeof MyNotification>;

export const MyNotifications = z.object({
  items: z.array(MyNotification),
  nextCursor: z.string().nullable(),
  unreadCount: z.number(),
});

export const DeliveryRow = z.object({
  id: z.string(),
  email: z.string(),
  event: z.string(),
  channel: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastError: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DeliveryRow = z.infer<typeof DeliveryRow>;

export const DeliveryLog = z.object({ items: z.array(DeliveryRow), nextCursor: z.string().nullable() });
