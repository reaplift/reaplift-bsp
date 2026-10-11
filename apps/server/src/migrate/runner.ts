import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

/** Arbitrary constant so two migrate runs never overlap. */
const LOCK_ID = 7_412_031;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every `NNNN_name.sql` file in `dir` that is not yet recorded in
 * schema_migrations, in name order, each in its own transaction.
 */
export async function migrate(pool: pg.Pool, dir: string): Promise<MigrateResult> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`);
    const done = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    const result: MigrateResult = { applied: [], skipped: [] };
    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const body = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(body);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}
