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

  it('adds the milestone 1 message and client schema', async () => {
    await pool.query('drop table if exists message_status_events');
    await pool.query('drop table if exists meta_events');
    await pool.query('drop table if exists messages');
    await pool.query('drop table if exists templates');
    await pool.query('drop table if exists wa_accounts');
    await pool.query('drop table if exists clients');
    await pool.query('drop table if exists schema_migrations');

    const result = await migrate(pool, migrationsDir());
    expect(result.applied).toContain('0001_init.sql');
    expect(result.applied).toContain('0002_message_platform.sql');

    const tables = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('clients', 'wa_accounts', 'templates', 'messages', 'meta_events', 'message_status_events')
      order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'clients',
      'message_status_events',
      'messages',
      'meta_events',
      'templates',
      'wa_accounts',
    ]);

    const columns = await pool.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_name in ('clients', 'wa_accounts', 'templates', 'messages')
        and table_schema = 'public'
      order by table_name, ordinal_position
    `);

    expect(columns.rows.map((row) => row.column_name)).toContain('client_id');
    expect(columns.rows.map((row) => row.column_name)).toContain('status');
    expect(columns.rows.map((row) => row.column_name)).toContain('created_at');
  });
});
