import { sql } from 'kysely';
import { buildApp, type AppDeps } from '../../src/app.js';
import { createDb, createPool } from '../../src/lib/db.js';
import { migrate } from '../../src/migrate/runner.js';
import { migrationsDir } from '../../src/modes/migrate.js';
import { createUser } from '../../src/modules/auth/users.js';

export const PANEL = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-1';

/**
 * M1's worked example in a fresh database: three clients, a super admin, a staff member assigned
 * to Northwind and Bluebird, and one client user each for Northwind and Greenleaf.
 */
export async function createWorld() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');
  const pool = createPool(url);
  const db = createDb(pool);

  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
  await migrate(pool, migrationsDir());

  const client = async (name: string, status = 'active') =>
    (
      await sql<{
        id: string;
      }>`insert into clients (name, status, country_calling_code) values (${name}, ${status}, '91') returning id`.execute(db)
    ).rows[0]!.id;
  const northwind = await client('Northwind Labs');
  const bluebird = await client('Bluebird Retail');
  const greenleaf = await client('Greenleaf Foods');
  const suspended = await client('Paused Co', 'suspended');

  const user = (email: string, role: 'super_admin' | 'staff' | 'client', clientId?: string) =>
    createUser(db, { email, name: email.split('@')[0]!, role, clientId, password: PASSWORD });
  await user('ravi@reaplift.com', 'super_admin');
  const meera = await user('meera@reaplift.com', 'staff');
  await user('ops@northwind.com', 'client', northwind);
  await user('sales@greenleaf.in', 'client', greenleaf);
  await user('ops@paused.co', 'client', suspended);
  for (const clientId of [northwind, bluebird]) {
    await sql`insert into staff_clients (staff_user_id, client_id) values (${meera.id}, ${clientId})`.execute(
      db,
    );
  }

  let clock = new Date('2026-11-02T10:00:00Z');
  const makeApp = (extra: Partial<AppDeps> = {}) =>
    buildApp({
      version: 'test',
      checkDb: async () => true,
      db,
      now: () => clock,
      panelOrigin: PANEL,
      ...extra,
    });
  const app = makeApp();

  /** Logs in and returns the cookie header to send on later requests. */
  const login = async (email: string, password = PASSWORD) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: PANEL },
      payload: { email, password },
    });
    const setCookie = String(res.headers['set-cookie'] ?? '');
    return { res, cookie: setCookie.split(';')[0]! };
  };

  return {
    pool,
    db,
    app,
    makeApp,
    login,
    ids: { northwind, bluebird, greenleaf, suspended },
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}
