import pg from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';

/** Table types grow here as migrations add tables (milestone 1 onward). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export function createPool(databaseUrl: string) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
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
