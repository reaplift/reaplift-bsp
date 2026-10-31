import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { ChangePassword } from '@reaplift/shared';
import { hashPassword, verifyPassword } from '../../lib/auth.js';
import type { Database } from '../../lib/db.js';
import { readPage } from '../../lib/pagination.js';
import { sendError } from '../auth/scope.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything here acts on the logged-in user; no route takes a user ID. */
export function registerMeRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  app.post('/api/me/password', async (req, reply) => {
    const parsed = ChangePassword.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_REQUEST', 'The new password needs at least 10 characters');
    }
    const { userId, sessionId } = req.auth!;
    const { password_hash: currentHash } = (
      await sql<{ password_hash: string }>`select password_hash from users where id = ${userId}`.execute(db)
    ).rows[0]!;
    if (!(await verifyPassword(parsed.data.currentPassword, currentHash))) {
      return sendError(reply, 401, 'INVALID_CREDENTIALS', 'The current password is wrong');
    }
    if (parsed.data.newPassword === parsed.data.currentPassword) {
      return sendError(reply, 400, 'INVALID_REQUEST', 'Choose a password different from the current one');
    }

    const hash = await hashPassword(parsed.data.newPassword);
    await db.transaction().execute(async (trx) => {
      await sql`update users set password_hash = ${hash}, must_change_password = false where id = ${userId}`.execute(trx);
      // Any other device logged in with the old password is logged out; this one stays in.
      await sql`
        update auth_sessions set revoked_at = ${now()}
        where user_id = ${userId} and id <> ${sessionId} and revoked_at is null
      `.execute(trx);
    });
    return reply.code(200).send({ changed: true });
  });

  app.get('/api/me/notifications', async (req, reply) => {
    const { limit } = readPage(req.query);
    const { userId } = req.auth!;
    const rows = await sql`
      select id, client_id as "clientId", event, payload, status, read_at as "readAt", created_at as "createdAt"
      from notifications
      where user_id = ${userId} and channel = 'panel'
      order by created_at desc, id
      limit ${limit}
    `.execute(db);
    const unread = await sql<{ count: number }>`
      select count(*)::int as count from notifications
      where user_id = ${userId} and channel = 'panel' and read_at is null
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null, unreadCount: unread.rows[0]!.count });
  });

  app.patch('/api/me/notifications/:notificationId/read', async (req, reply) => {
    const { notificationId: id } = req.params as { notificationId: string };
    if (!UUID.test(id)) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    const updated = await sql`
      update notifications set status = 'read', read_at = coalesce(read_at, ${now()})
      where id = ${id} and user_id = ${req.auth!.userId} and channel = 'panel'
    `.execute(db);
    if (Number(updated.numAffectedRows ?? 0) === 0) return sendError(reply, 404, 'NOT_FOUND', 'Not found');
    return reply.code(200).send({ read: true });
  });
}
