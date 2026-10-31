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
