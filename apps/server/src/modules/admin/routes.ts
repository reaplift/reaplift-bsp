import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { ClientCreate, ClientEdit, ResetPassword, StaffClients, StatusNote, UserCreate, UserStatus } from '@reaplift/shared';
import { hashPassword } from '../../lib/auth.js';
import type { Database } from '../../lib/db.js';
import { readPage, toPage } from '../../lib/pagination.js';
import { sendError } from '../auth/scope.js';
import { createUser, EmailTakenError } from '../auth/users.js';
import { notify } from '../notifications/notify.js';
import { readBalance, readOnHold } from '../wallet/ledger.js';
import { recomputePrices } from '../wallet/pricing.js';
import { writeAudit } from './audit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLIENT = sql`
  id, name, status, country_calling_code as "countryCallingCode", contact_email as "contactEmail",
  low_balance_alert_paise as "lowBalanceAlertPaise", created_at as "createdAt"
`;

interface ClientRow {
  id: string;
  name: string;
  status: string;
  contactEmail: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  client_id: string | null;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';
const notFound = (reply: FastifyReply) => sendError(reply, 404, 'NOT_FOUND', 'Not found');
const invalid = (reply: FastifyReply, details: unknown, message = 'Check the fields and try again') =>
  reply.code(400).send({ error: 'INVALID_REQUEST', message, details });
const nameTaken = (reply: FastifyReply) => sendError(reply, 409, 'CLIENT_NAME_TAKEN', 'A client already has this name');

function revokeUserSessions(trx: Transaction<Database>, userId: string, at: Date) {
  return sql`update auth_sessions set revoked_at = ${at} where user_id = ${userId} and revoked_at is null`.execute(trx);
}

async function clientsExist(db: Kysely<Database>, ids: string[]) {
  if (ids.length === 0) return true;
  const found = await sql<{ count: number }>`
    select count(*)::int as count from clients where id in (${sql.join(ids)})
  `.execute(db);
  return found.rows[0]!.count === new Set(ids).size;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; now: () => Date; panelOrigin: string },
) {
  const { db, now, panelOrigin } = deps;

  app.get('/api/admin/clients', async (_req, reply) => {
    const rows = await sql`select ${CLIENT} from clients order by name limit 500`.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.post('/api/admin/clients', async (req, reply) => {
    const parsed = ClientCreate.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { name, countryCallingCode, contactEmail } = parsed.data;
    try {
      const client = await db.transaction().execute(async (trx) => {
        const row = (
          await sql<ClientRow>`
            insert into clients (name, country_calling_code, contact_email)
            values (${name}, ${countryCallingCode}, ${contactEmail})
            returning ${CLIENT}
          `.execute(trx)
        ).rows[0]!;
        await writeAudit(trx, {
          clientId: row.id,
          userId: req.auth!.userId,
          action: 'client.created',
          entityType: 'client',
          entityId: row.id,
          after: { name, countryCallingCode, contactEmail },
          at: now(),
        });
        await notify(trx, 'client.created', { clientId: row.id, email: contactEmail, entityId: row.id }, { name });
        await recomputePrices(trx, now(), row.id);
        return row;
      });
      return reply.code(201).send(client);
    } catch (err) {
      if (isUniqueViolation(err)) return nameTaken(reply);
      throw err;
    }
  });

  app.get('/api/admin/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const client = (await sql`select ${CLIENT} from clients where id = ${id}`.execute(db)).rows[0];
    if (!client) return notFound(reply);
    const users = await sql`
      select id, name, email, role, status from users where client_id = ${id} order by name
    `.execute(db);
    const staff = await sql`
      select u.id, u.name, u.email, u.status from users u
      join staff_clients sc on sc.staff_user_id = u.id
      where sc.client_id = ${id} order by u.name
    `.execute(db);
    return reply.code(200).send({
      ...(client as object),
      balancePaise: await readBalance(db, id),
      onHoldPaise: await readOnHold(db, id),
      users: users.rows,
      staff: staff.rows,
    });
  });

  app.patch('/api/admin/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const parsed = ClientEdit.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    try {
      const client = await db.transaction().execute(async (trx) => {
        const before = (
          await sql<{ name: string; contact_email: string | null }>`
            select name, contact_email from clients where id = ${id} for update
          `.execute(trx)
        ).rows[0];
        if (!before) return null;
        const name = parsed.data.name ?? before.name;
        const contactEmail = parsed.data.contactEmail ?? before.contact_email;
        const row = (
          await sql`
            update clients set name = ${name}, contact_email = ${contactEmail} where id = ${id} returning ${CLIENT}
          `.execute(trx)
        ).rows[0];
        await writeAudit(trx, {
          clientId: id,
          userId: req.auth!.userId,
          action: 'client.edited',
          entityType: 'client',
          entityId: id,
          before: { name: before.name, contactEmail: before.contact_email },
          after: { name, contactEmail },
          at: now(),
        });
        return row;
      });
      if (!client) return notFound(reply);
      return reply.code(200).send(client);
    } catch (err) {
      if (isUniqueViolation(err)) return nameTaken(reply);
      throw err;
    }
  });

  for (const [path, from, to, action, event] of [
    ['suspend', 'active', 'suspended', 'client.suspended', 'client.suspended'],
    ['reactivate', 'suspended', 'active', 'client.reactivated', 'client.reactivated'],
  ] as const) {
    app.post(`/api/admin/clients/:id/${path}`, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!UUID.test(id)) return notFound(reply);
      const parsed = StatusNote.safeParse(req.body);
      if (!parsed.success) return invalid(reply, parsed.error.flatten(), 'A note is required');

      const result = await db.transaction().execute(async (trx) => {
        const client = (
          await sql<{ name: string; status: string }>`select name, status from clients where id = ${id} for update`.execute(trx)
        ).rows[0];
        if (!client) return 'missing' as const;
        if (client.status !== from) return 'unchanged' as const;
        await sql`update clients set status = ${to} where id = ${id}`.execute(trx);
        const auditId = await writeAudit(trx, {
          clientId: id,
          userId: req.auth!.userId,
          action,
          entityType: 'client',
          entityId: id,
          before: { status: from },
          after: { status: to },
          note: parsed.data.note,
          at: now(),
        });
        await notify(trx, event, { clientId: id, entityId: `${id}:${auditId}` }, { name: client.name, note: parsed.data.note });
        return 'changed' as const;
      });
      if (result === 'missing') return notFound(reply);
      if (result === 'unchanged') return sendError(reply, 409, 'STATUS_UNCHANGED', `This client is not ${from}`);
      return reply.code(200).send({ status: to });
    });
  }

  app.post('/api/admin/users', async (req, reply) => {
    const parsed = UserCreate.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const { name, email, role, clientId, password, clientIds = [] } = parsed.data;
    if (role === 'client' && (!clientId || clientIds.length > 0)) {
      return invalid(reply, {}, 'A client user needs one clientId');
    }
    if (role === 'staff' && clientId) return invalid(reply, {}, 'Staff are assigned with clientIds');
    if (!(await clientsExist(db, clientId ? [clientId] : clientIds))) {
      return invalid(reply, {}, 'A client in this request does not exist');
    }

    try {
      const user = await db.transaction().execute(async (trx) => {
        const { id } = await createUser(trx, {
          name,
          email,
          role,
          clientId: clientId ?? null,
          password,
          createdBy: req.auth!.userId,
          mustChangePassword: true,
        });
        for (const assigned of clientIds) {
          await sql`insert into staff_clients (staff_user_id, client_id) values (${id}, ${assigned}) on conflict do nothing`.execute(trx);
        }
        const auditId = await writeAudit(trx, {
          clientId: clientId ?? null,
          userId: req.auth!.userId,
          action: 'user.created',
          entityType: 'user',
          entityId: id,
          after: { name, email, role, clientId: clientId ?? null, clientIds },
          at: now(),
        });
        await notify(trx, 'user.created', { clientId: clientId ?? null, userId: id }, { name, email, panelUrl: panelOrigin });
        if (clientIds.length > 0) await notifyAssignment(trx, id, clientIds, auditId);
        return { id, name, email, role, clientId: clientId ?? null, status: 'active' };
      });
      return reply.code(201).send(user);
    } catch (err) {
      if (err instanceof EmailTakenError) return sendError(reply, 409, 'EMAIL_TAKEN', 'This email already has a login');
      throw err;
    }
  });

  async function notifyAssignment(trx: Transaction<Database>, staffId: string, clientIds: string[], auditId: number) {
    const names =
      clientIds.length === 0
        ? []
        : (
            await sql<{ name: string }>`
              select name from clients where id in (${sql.join(clientIds)}) order by name
            `.execute(trx)
          ).rows.map((row) => row.name);
    await notify(trx, 'staff.assigned', { userId: staffId, entityId: `${staffId}:${auditId}` }, { clients: names });
  }

  const readUser = async (trx: Kysely<Database>, id: string) =>
    (
      await sql<UserRow>`
        select id, name, email, role, status, client_id from users where id = ${id} for update
      `.execute(trx)
    ).rows[0];

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const parsed = UserStatus.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    if (id === req.auth!.userId) return sendError(reply, 409, 'CANNOT_CHANGE_SELF', 'You cannot disable your own login');
    const status = parsed.data.status;

    const found = await db.transaction().execute(async (trx) => {
      const user = await readUser(trx, id);
      if (!user) return false;
      if (user.status === status) return true;
      const at = now();
      await sql`update users set status = ${status} where id = ${id}`.execute(trx);
      if (status === 'disabled') await revokeUserSessions(trx, id, at);
      await writeAudit(trx, {
        clientId: user.client_id,
        userId: req.auth!.userId,
        action: status === 'disabled' ? 'user.disabled' : 'user.enabled',
        entityType: 'user',
        entityId: id,
        before: { status: user.status },
        after: { status },
        at,
      });
      return true;
    });
    if (!found) return notFound(reply);
    return reply.code(200).send({ status });
  });

  app.post('/api/admin/users/:id/reset-password', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const parsed = ResetPassword.safeParse(req.body);
    if (!parsed.success) return invalid(reply, {}, 'The new password needs at least 10 characters');
    const hash = await hashPassword(parsed.data.password);

    const found = await db.transaction().execute(async (trx) => {
      const user = await readUser(trx, id);
      if (!user) return false;
      const at = now();
      await sql`update users set password_hash = ${hash}, must_change_password = true where id = ${id}`.execute(trx);
      await revokeUserSessions(trx, id, at);
      const auditId = await writeAudit(trx, {
        clientId: user.client_id,
        userId: req.auth!.userId,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
        at,
      });
      await notify(trx, 'user.password_reset', { clientId: user.client_id, userId: id, entityId: `${id}:${auditId}` }, { name: user.name });
      return true;
    });
    if (!found) return notFound(reply);
    return reply.code(200).send({ reset: true });
  });

  app.put('/api/admin/users/:id/clients', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!UUID.test(id)) return notFound(reply);
    const parsed = StaffClients.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error.flatten());
    const clientIds = [...new Set(parsed.data.clientIds)].sort();
    if (!(await clientsExist(db, clientIds))) return invalid(reply, {}, 'A client in this request does not exist');

    const result = await db.transaction().execute(async (trx) => {
      const user = await readUser(trx, id);
      if (!user) return 'missing' as const;
      if (user.role !== 'staff') return 'not-staff' as const;
      const before = (
        await sql<{ client_id: string }>`
          select client_id from staff_clients where staff_user_id = ${id} order by client_id
        `.execute(trx)
      ).rows.map((row) => row.client_id);
      await sql`delete from staff_clients where staff_user_id = ${id}`.execute(trx);
      for (const clientId of clientIds) {
        await sql`insert into staff_clients (staff_user_id, client_id) values (${id}, ${clientId})`.execute(trx);
      }
      const auditId = await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'staff.assigned',
        entityType: 'user',
        entityId: id,
        before,
        after: clientIds,
        at: now(),
      });
      await notifyAssignment(trx, id, clientIds, auditId);
      return 'saved' as const;
    });
    if (result === 'missing') return notFound(reply);
    if (result === 'not-staff') return sendError(reply, 409, 'NOT_STAFF', 'Only staff are assigned clients');
    return reply.code(200).send({ clientIds });
  });

  app.get('/api/admin/audit', async (req, reply) => {
    const { limit, cursor } = readPage(req.query);
    const { clientId, userId, action, from, to } = req.query as Record<string, string | undefined>;
    if ((clientId && !UUID.test(clientId)) || (userId && !UUID.test(userId))) return invalid(reply, {}, 'Bad filter');
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return invalid(reply, {}, 'Bad date');
    }
    const rows = await sql<{ id: number }>`
      select a.id, a.client_id as "clientId", a.user_id as "userId", u.name as "userName", a.action,
        a.entity_type as "entityType", a.entity_id as "entityId", a.details, a.created_at as "createdAt"
      from audit_logs a
      left join users u on u.id = a.user_id
      where ${cursor ? sql`a.id < ${cursor}` : sql`true`}
        and ${clientId ? sql`a.client_id = ${clientId}` : sql`true`}
        and ${userId ? sql`a.user_id = ${userId}` : sql`true`}
        and ${action ? sql`a.action = ${action}` : sql`true`}
        and ${fromDate ? sql`a.created_at >= ${fromDate}` : sql`true`}
        and ${toDate ? sql`a.created_at <= ${toDate}` : sql`true`}
      order by a.id desc
      limit ${limit + 1}
    `.execute(db);
    return reply.code(200).send(toPage(rows.rows, limit));
  });

  app.get('/api/admin/notifications', async (req, reply) => {
    const { limit } = readPage(req.query);
    const { status } = req.query as { status?: string };
    const rows = await sql`
      select id, client_id as "clientId", email, event, channel, status, attempts, last_error as "lastError",
        next_attempt_at as "nextAttemptAt", sent_at as "sentAt", created_at as "createdAt"
      from notifications
      where ${status ? sql`status = ${status}` : sql`true`}
      order by created_at desc, id
      limit ${limit}
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });
}
