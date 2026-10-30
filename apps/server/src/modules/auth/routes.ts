import { serialize as serializeCookie } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { UserRole } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { verifyPassword } from '../../lib/auth.js';
import { listWorkspaces, sendError } from './scope.js';
import { createSession, MAX_AGE_MS, revokeSession, SESSION_COOKIE } from './sessions.js';

/** 10 wrong passwords within 15 minutes lock the login for 15 minutes. */
export const LOCKOUT_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

const LoginBody = z.object({ email: z.string().min(1), password: z.string().min(1) }).strict();

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; cookieSecure: boolean },
) {
  const { db, now, cookieSecure } = deps;
  const cookie = (value: string, maxAge: number) =>
    serializeCookie(SESSION_COOKIE, value, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge,
    });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, 400, 'INVALID_REQUEST', 'Send email and password only');

    const at = now();
    const email = parsed.data.email.trim().toLowerCase();
    const user = (
      await sql<{
        id: string;
        name: string;
        email: string;
        role: UserRole;
        client_id: string | null;
        status: string;
        password_hash: string;
        locked_until: Date | null;
      }>`
        select id, name, email, role, client_id, status, password_hash, locked_until
        from users where email = ${email}
      `.execute(db)
    ).rows[0];

    if (user?.locked_until && user.locked_until > at) {
      return reply.code(423).send({
        error: 'LOGIN_LOCKED',
        message: 'Too many failed logins; try again later',
        lockedUntil: user.locked_until.toISOString(),
      });
    }

    const passwordOk = await verifyPassword(parsed.data.password, user?.password_hash ?? null);
    const invalid = () => sendError(reply, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    if (!user) return invalid();

    if (!passwordOk) {
      const windowStart = new Date(at.getTime() - LOCKOUT_WINDOW_MS);
      const { failed_login_count: failures } = (
        await sql<{ failed_login_count: number }>`
          update users set
            failed_login_count = case
              when first_failed_login_at is null or first_failed_login_at <= ${windowStart} then 1
              else coalesce(failed_login_count, 0) + 1 end,
            first_failed_login_at = case
              when first_failed_login_at is null or first_failed_login_at <= ${windowStart} then ${at}
              else first_failed_login_at end
          where id = ${user.id}
          returning failed_login_count
        `.execute(db)
      ).rows[0]!;
      if (failures >= LOCKOUT_FAILURES) {
        await sql`
          update users set locked_until = ${new Date(at.getTime() + LOCKOUT_WINDOW_MS)},
                           failed_login_count = null, first_failed_login_at = null
          where id = ${user.id}
        `.execute(db);
      }
      return invalid();
    }

    if (user.status !== 'active') return invalid();

    await sql`
      update users set failed_login_count = null, first_failed_login_at = null, locked_until = null,
                       last_login_at = ${at}
      where id = ${user.id}
    `.execute(db);
    const { token } = await createSession(db, { id: user.id, clientId: user.client_id }, at, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    reply.header('set-cookie', cookie(token, MAX_AGE_MS / 1000));
    return reply
      .code(200)
      .send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await revokeSession(db, req.auth!.sessionId, now());
    reply.header('set-cookie', cookie('', 0));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req, reply) => {
    const { userId, name, email, role } = req.auth!;
    return reply.code(200).send({
      user: { id: userId, name, email, role },
      workspaces: await listWorkspaces(db, req.auth!),
    });
  });

  // The workspace header: the one client route M1 has, so the scope rules have a route to guard.
  app.get('/api/clients/:clientId', async (req, reply) => {
    const client = (
      await sql<{ id: string; name: string; status: string }>`
        select id, name, status from clients where id = ${req.scope!.clientId}
      `.execute(db)
    ).rows[0]!;
    return reply.code(200).send({ clientId: client.id, name: client.name, status: client.status });
  });
}
