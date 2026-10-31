import { parse as parseCookies } from 'cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { UserRole } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { findSession, SESSION_COOKIE, type SessionUser } from './sessions.js';

export interface Scope {
  userId: string;
  role: UserRole;
  /** The client named in the path; checked against the user's access before any handler runs. */
  clientId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set for every route that needs a login. */
    auth?: SessionUser;
    /** Set for every `/api/clients/:clientId/...` route. */
    scope?: Scope;
  }
}

/** Routes anyone may call. Everything else under `/api` needs a login. */
export const PUBLIC_ROUTES = ['/healthz', '/api/auth/login', '/webhooks/meta'];
/** Routes any logged-in user may call; they act only on the caller's own session. */
export const SESSION_ROUTES = ['/api/auth/logout', '/api/auth/me'];

/** All a user with a first password may do. */
const PASSWORD_CHANGE_ROUTES = ['/api/me/password', '/api/auth/logout'];

export type RouteKind = 'public' | 'session' | 'client' | 'admin' | 'me' | 'unscoped';

/** Which access rule a route pattern (as registered, e.g. `/api/clients/:clientId/x`) falls under. */
export function classifyRoute(url: string): RouteKind {
  if (PUBLIC_ROUTES.includes(url)) return 'public';
  if (SESSION_ROUTES.includes(url)) return 'session';
  if (url === '/api/clients/:clientId' || url.startsWith('/api/clients/:clientId/'))
    return 'client';
  if (url.startsWith('/api/admin/')) return 'admin';
  if (url.startsWith('/api/me/')) return 'me';
  return 'unscoped';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sendError(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message });
}

/** True when the user may act for this client. Unknown and forbidden clients look the same to the caller. */
async function canAccessClient(
  db: Kysely<Database>,
  user: SessionUser,
  clientId: string,
): Promise<boolean> {
  if (user.role === 'client') return user.clientId === clientId;
  if (user.role === 'staff') {
    const row = await sql`
      select 1 from staff_clients where staff_user_id = ${user.userId} and client_id = ${clientId}
    `.execute(db);
    return row.rows.length > 0;
  }
  return true;
}

/**
 * Resolves who is calling and what they may touch, before any handler runs.
 * Fails closed: a route that matches no rule answers 404.
 */
export function registerScope(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; panelOrigin: string },
) {
  const { db, now, panelOrigin } = deps;

  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions.url;

    // Cookie-carrying requests from another site are refused. Meta's webhook is signed instead.
    if (
      STATE_CHANGING.has(req.method) &&
      url !== '/webhooks/meta' &&
      req.headers.origin !== panelOrigin
    ) {
      return sendError(reply, 403, 'FORBIDDEN', 'Request origin not allowed');
    }

    if (!url) return; // no route matched; Fastify answers 404
    const kind = classifyRoute(url);
    if (kind === 'public') return;
    if (kind === 'unscoped') {
      req.log.error(
        { url },
        'route has no access rule; add it under /api/clients/, /api/admin/ or /api/me/',
      );
      return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    }

    const token = parseCookies(req.headers.cookie ?? '')[SESSION_COOKIE];
    const user = token ? await findSession(db, token, now()) : null;
    if (!user) return sendError(reply, 401, 'UNAUTHENTICATED', 'Please log in');
    req.auth = user;

    if (user.mustChangePassword && !PASSWORD_CHANGE_ROUTES.includes(url)) {
      return sendError(reply, 403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password first');
    }

    if (kind === 'admin' && user.role !== 'super_admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Only a super admin can do this');
    }

    if (kind === 'client') {
      const clientId = (req.params as { clientId?: string }).clientId ?? '';
      const client = UUID.test(clientId)
        ? (
            await sql<{
              status: string;
            }>`select status from clients where id = ${clientId}`.execute(db)
          ).rows[0]
        : undefined;
      if (!client || !(await canAccessClient(db, user, clientId))) {
        return sendError(reply, 404, 'NOT_FOUND', 'Not found');
      }
      // ReapLift's own admin still needs to see its wallet and stop its campaigns.
      if (client.status === 'suspended' && user.role !== 'super_admin') {
        return sendError(reply, 403, 'CLIENT_SUSPENDED', 'This client is suspended');
      }
      req.scope = { userId: user.userId, role: user.role, clientId };
    }
  });
}

/** The client workspaces a user can open: their own, their assigned ones, or all of them. */
export async function listWorkspaces(db: Kysely<Database>, user: SessionUser) {
  const rows =
    user.role === 'client'
      ? await sql<{ id: string; name: string; status: string }>`
          select id, name, status from clients where id = ${user.clientId} order by name`.execute(
          db,
        )
      : user.role === 'staff'
        ? await sql<{ id: string; name: string; status: string }>`
            select c.id, c.name, c.status from clients c
            join staff_clients sc on sc.client_id = c.id
            where sc.staff_user_id = ${user.userId} order by c.name`.execute(db)
        : await sql<{ id: string; name: string; status: string }>`
            select id, name, status from clients order by name`.execute(db);
  return rows.rows.map((r) => ({ clientId: r.id, name: r.name, status: r.status }));
}
