import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/lib/db.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');
const pool = createPool(url);

afterAll(() => pool.end());

describe('migrate', () => {
  it('applies pending migrations and changes nothing on a second run', async () => {
    await pool.query('drop table if exists schema_migrations');
    const first = await migrate(pool, migrationsDir());
    expect(first.applied).toContain('0001_init.sql');

    const before = await pool.query('select name, applied_at from schema_migrations order by name');
    const second = await migrate(pool, migrationsDir());
    const after = await pool.query('select name, applied_at from schema_migrations order by name');

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);
    expect(after.rows).toEqual(before.rows);
  });
});
