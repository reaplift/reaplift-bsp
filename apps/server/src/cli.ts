/**
 * Operator commands: `pnpm --filter @reaplift/server cli <command> [--flag value ...]`.
 *
 *   create-user --email <e> --name <n> --role <super_admin|staff|client> [--client <client id or exact name>] [--created-by <super admin email>]
 *       Prompts for the password (not echoed). Reads it from stdin when not run in a terminal.
 *   seed-dev
 *       Local development only: the clients and four users of M1's worked example, password `reaplift-dev-1`.
 *   notify-test --email <address>
 *       Writes one test notification; the worker's delivery loop sends it.
 *   show-notifications [--status pending|sent|failed|read] [--limit <n>]
 *       Lists recent notifications, newest first.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { sql, type Kysely } from 'kysely';
import { USER_ROLES, type UserRole } from '@reaplift/shared';
import { loadConfig } from './config.js';
import { createDb, createPool, type Database } from './lib/db.js';
import { createUser, UserInputError } from './modules/auth/users.js';
import { notify } from './modules/notifications/notify.js';

const DEV_PASSWORD = 'reaplift-dev-1';

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!key?.startsWith('--') || args[i + 1] === undefined)
      throw new UserInputError(`expected --flag value at "${key}"`);
    out[key.slice(2)] = args[i + 1]!;
  }
  return out;
}

async function readPassword(): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  const ask = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, (a) => {
        if (process.stdin.isTTY) process.stdout.write('\n');
        resolve(a);
      });
      muted = true;
    });
  const first = await ask('Password: ');
  muted = false;
  const second = process.stdin.isTTY ? await ask('Repeat password: ') : first;
  rl.close();
  if (first !== second) throw new UserInputError('passwords do not match');
  return first;
}

async function findClientId(db: Kysely<Database>, idOrName: string): Promise<string> {
  const rows = (
    await sql<{
      id: string;
    }>`select id from clients where id::text = ${idOrName} or name = ${idOrName}`.execute(db)
  ).rows;
  if (rows.length !== 1) throw new UserInputError(`no single client matches "${idOrName}"`);
  return rows[0]!.id;
}

async function findSuperAdminId(db: Kysely<Database>, email: string): Promise<string> {
  const row = (
    await sql<{ id: string }>`
      select id from users where email = ${email.trim().toLowerCase()} and role = 'super_admin'
    `.execute(db)
  ).rows[0];
  if (!row) throw new UserInputError(`no super admin has the email "${email}"`);
  return row.id;
}

async function ensureClient(
  db: Kysely<Database>,
  name: string,
  contactEmail: string,
): Promise<string> {
  const existing = (
    await sql<{ id: string }>`select id from clients where name = ${name}`.execute(db)
  ).rows[0];
  if (existing) return existing.id;
  return (
    await sql<{ id: string }>`
      insert into clients (name, contact_email) values (${name}, ${contactEmail}) returning id
    `.execute(db)
  ).rows[0]!.id;
}

async function ensureUser(
  db: Kysely<Database>,
  user: { email: string; name: string; role: UserRole; clientId?: string; createdBy?: string },
): Promise<string> {
  const existing = (
    await sql<{ id: string }>`select id from users where email = ${user.email}`.execute(db)
  ).rows[0];
  if (existing) return existing.id;
  return (await createUser(db, { ...user, password: DEV_PASSWORD })).id;
}

async function seedDev(db: Kysely<Database>, databaseUrl: string) {
  const host = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', 'postgres'].includes(host)) {
    throw new UserInputError(`seed-dev runs only against a local database, not ${host}`);
  }
  const northwind = await ensureClient(db, 'Northwind Labs', 'ops@northwind.com');
  const bluebird = await ensureClient(db, 'Bluebird Retail', 'sales@bluebird.in');
  const greenleaf = await ensureClient(db, 'Greenleaf Foods', 'sales@greenleaf.in');

  const ravi = await ensureUser(db, {
    email: 'ravi@reaplift.com',
    name: 'Ravi',
    role: 'super_admin',
  });
  const meera = await ensureUser(db, {
    email: 'meera@reaplift.com',
    name: 'Meera',
    role: 'staff',
    createdBy: ravi,
  });
  await ensureUser(db, {
    email: 'ops@northwind.com',
    name: 'Northwind Ops',
    role: 'client',
    clientId: northwind,
    createdBy: ravi,
  });
  await ensureUser(db, {
    email: 'sales@greenleaf.in',
    name: 'Greenleaf Sales',
    role: 'client',
    clientId: greenleaf,
    createdBy: ravi,
  });

  for (const clientId of [northwind, bluebird]) {
    await sql`
      insert into staff_clients (staff_user_id, client_id) values (${meera}, ${clientId})
      on conflict (staff_user_id, client_id) do nothing
    `.execute(db);
  }
  console.log(`Seeded 3 clients and 4 users. Password for every seeded user: ${DEV_PASSWORD}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const config = loadConfig(process.env, []);
  const pool = createPool(config.DATABASE_URL);
  const db = createDb(pool);
  try {
    if (command === 'create-user') {
      const f = flags(rest);
      const role = f.role as UserRole;
      if (!USER_ROLES.includes(role))
        throw new UserInputError(`--role must be one of ${USER_ROLES.join(', ')}`);
      const clientId = f.client ? await findClientId(db, f.client) : null;
      const createdBy = f['created-by'] ? await findSuperAdminId(db, f['created-by']) : null;
      const { id } = await createUser(db, {
        email: f.email ?? '',
        name: f.name ?? '',
        role,
        clientId,
        createdBy,
        password: await readPassword(),
      });
      console.log(`Created ${role} ${f.email} (${id})`);
    } else if (command === 'seed-dev') {
      await seedDev(db, config.DATABASE_URL);
    } else if (command === 'notify-test') {
      const { email } = flags(rest);
      if (!email?.includes('@')) throw new UserInputError('--email <address> is required');
      const entityId = randomUUID(); // a new test each time, so a repeat is not swallowed as a replay
      await db
        .transaction()
        .execute((trx) =>
          notify(
            trx,
            'system.test',
            { email, entityId },
            { requestedAt: new Date().toISOString() },
          ),
        );
      console.log(
        `Queued test email to ${email} (entity ${entityId}); the worker sends it within seconds.`,
      );
    } else if (command === 'show-notifications') {
      const f = flags(rest);
      const limit = Number(f.limit ?? 20);
      const rows = (
        await sql<Record<string, unknown>>`
          select created_at, event, channel, email, status, attempts, next_attempt_at, sent_at, last_error
          from notifications
          where ${f.status ? sql`status = ${f.status}` : sql`true`}
          order by created_at desc
          limit ${Number.isInteger(limit) && limit > 0 ? limit : 20}
        `.execute(db)
      ).rows;
      console.table(rows);
    } else {
      throw new UserInputError('commands: create-user, seed-dev, notify-test, show-notifications');
    }
  } catch (err) {
    if (!(err instanceof UserInputError)) throw err;
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

await main();
