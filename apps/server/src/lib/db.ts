import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

/** Table types grow here as migrations add tables (milestone 1 onward). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

// `pg` returns bigint as text, so `a + b` would join two strings. OID 20 is bigint.
pg.types.setTypeParser(20, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`bigint ${value} is too large for a number`);
  return parsed;
});

export function createPool(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // An idle connection dropped by a database restart must not crash the process: the pool discards it,
  // and the next query reconnects or fails where it is handled.
  pool.on('error', () => {});
  return pool;
}

export function createDb(pool: pg.Pool) {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** True when the database answers a trivial query. */
export async function pingDb(db: Kysely<Database>): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
