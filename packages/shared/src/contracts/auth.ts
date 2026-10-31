import { z } from 'zod';
import type { UserRole } from '../index.js';

/**
 * Contracts for the M1 auth routes (spec: docs/milestones/m1-login-and-access/spec.md, "Data and
 * API"; real responses: backend-api.md). Response schemas are not strict, so a field the server
 * adds later does not break the panel; request schemas are, because the server refuses extras.
 */

/** Every error body: `{ "error": "<CODE>", "message": "<text>" }`. */
export const ApiErrorBody = z.object({ error: z.string(), message: z.string() });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

// Same values as USER_ROLES in index.ts. Repeated rather than imported, because index.ts re-exports
// this file and a runtime import back would be circular; the checks below keep the two in step.
export const AuthRole = z.enum(['super_admin', 'staff', 'client']);
type SameRoles = [UserRole] extends [z.infer<typeof AuthRole>]
  ? [z.infer<typeof AuthRole>] extends [UserRole]
    ? true
    : never
  : never;
const sameRoles: SameRoles = true;
void sameRoles;

export const AuthUser = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: AuthRole,
});
export type AuthUser = z.infer<typeof AuthUser>;

/** A client the user can open: their own, an assigned one, or (super admin) any. */
export const Workspace = z.object({
  clientId: z.string().min(1),
  name: z.string(),
  status: z.enum(['active', 'suspended']),
});
export type Workspace = z.infer<typeof Workspace>;

/** POST /api/auth/login. Email and password only; the server answers 400 to any other field. */
export const LoginRequest = z.object({ email: z.string().min(1), password: z.string().min(1) }).strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

/** 200 from POST /api/auth/login; the session itself travels in the httpOnly `rl_session` cookie. */
export const LoginResponse = z.object({ user: AuthUser });
export type LoginResponse = z.infer<typeof LoginResponse>;

/** 423 from POST /api/auth/login after 10 failed logins in 15 minutes. */
export const LoginLockedBody = ApiErrorBody.extend({
  error: z.literal('LOGIN_LOCKED'),
  lockedUntil: z.string().datetime(),
});
export type LoginLockedBody = z.infer<typeof LoginLockedBody>;

/** 200 from GET /api/auth/me. */
export const MeResponse = z.object({ user: AuthUser, workspaces: z.array(Workspace) });
export type MeResponse = z.infer<typeof MeResponse>;

// POST /api/auth/logout answers 204 with no body, so it has no response schema.
