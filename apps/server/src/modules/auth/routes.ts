import { serialize as serializeCookie } from 'cookie';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import type { UserRole } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { verifyPassword } from '../../lib/auth.js';
import { notify } from '../notifications/notify.js';
import { listWorkspaces, sendError } from './scope.js';
import { createSession, MAX_AGE_MS, revokeSession, SESSION_COOKIE } from './sessions.js';

/** 5 wrong passwords in a row lock the login for 24 hours, or until a super admin unlocks it or resets its password (owner, 7 November 2026). */
export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_MS = 24 * 60 * 60 * 1000;

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
        login_locked_at: Date | null;
      }>`
        select id, name, email, role, client_id, status, password_hash, login_locked_at
        from users where email = ${email}
      `.execute(db)
    ).rows[0];

    if (user?.login_locked_at && at.getTime() - user.login_locked_at.getTime() < LOCKOUT_MS) {
      return sendError(reply, 423, 'LOGIN_LOCKED', 'This login is locked for 24 hours after too many wrong passwords');
    }

    const passwordOk = await verifyPassword(parsed.data.password, user?.password_hash ?? null);
    const invalid = () => sendError(reply, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
    if (!user) return invalid();

    if (!passwordOk) {
      // Counts wrong passwords in a row; a right one sets the count back to nothing.
      if (user.login_locked_at) {
        await sql`update users set login_locked_at = null, failed_login_count = null where id = ${user.id}`.execute(db);
      }
      const locked = (
        await sql<{ locked: boolean }>`
          update users set
            failed_login_count = coalesce(failed_login_count, 0) + 1,
            -- A lock that has run out starts a new count, so the next lock is a fresh 24 hours.
            login_locked_at = case when coalesce(failed_login_count, 0) + 1 >= ${LOCKOUT_FAILURES} then ${at}::timestamptz end
          where id = ${user.id}
          returning login_locked_at is not null as locked
        `.execute(db)
      ).rows[0]!.locked;
      if (locked) {
        await db.transaction().execute(async (trx) => {
          await sql`update users set failed_login_count = null where id = ${user.id}`.execute(trx);
          await notify(
            trx,
            'user.locked',
            { clientId: user.client_id, userId: user.id, entityId: `${user.id}:${at.toISOString()}` },
            { name: user.name, email: user.email },
          );
          await notify(trx, 'user.locked_admin', { entityId: `${user.id}:${at.toISOString()}` }, { name: user.name, email: user.email });
        });
      }
      return invalid();
    }

    if (user.status !== 'active') return invalid();

    await sql`
      update users set failed_login_count = null, login_locked_at = null, last_login_at = ${at}
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
