import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/lib/db.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';
import { resetDb } from './reset-db.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');
const pool = createPool(url);

afterAll(() => pool.end());

describe.sequential('migrate', () => {
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

  it('adds the milestone 1 message and admin access schema', async () => {
    await resetDb(pool);

    const result = await migrate(pool, migrationsDir());
    expect(result.applied).toContain('0001_init.sql');
    expect(result.applied).toContain('0002_message_platform.sql');
    expect(result.applied).toContain('0003_admin_access.sql');

    const tables = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'clients',
          'wa_accounts',
          'templates',
          'messages',
          'meta_events',
          'message_status_events',
          'users',
          'sessions',
          'staff_clients',
          'audit_logs'
        )
      order by table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'audit_logs',
      'clients',
      'message_status_events',
      'messages',
      'meta_events',
      'sessions',
      'staff_clients',
      'templates',
      'users',
      'wa_accounts',
    ]);

    const columns = await pool.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_name in ('clients', 'wa_accounts', 'templates', 'messages', 'users', 'sessions', 'staff_clients', 'audit_logs')
        and table_schema = 'public'
      order by table_name, ordinal_position
    `);

    expect(columns.rows.map((row) => row.column_name)).toContain('client_id');
    expect(columns.rows.map((row) => row.column_name)).toContain('status');
    expect(columns.rows.map((row) => row.column_name)).toContain('created_at');
    expect(columns.rows.map((row) => row.column_name)).toContain('role');
  });

  it('adds the milestone 4 list tables, each scoped to a client', async () => {
    await resetDb(pool);
    const result = await migrate(pool, migrationsDir());
    expect(result.applied).toContain('0004_lists.sql');

    const clientColumns = await pool.query<{ table_name: string; is_nullable: string }>(`
      select table_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and column_name = 'client_id' and table_name in ('lists', 'list_contacts')
      order by table_name
    `);
    expect(clientColumns.rows).toEqual([
      { table_name: 'list_contacts', is_nullable: 'NO' },
      { table_name: 'lists', is_nullable: 'NO' },
    ]);

    // Deleting a list takes its rows with it; a client with lists cannot be deleted.
    const client = await pool.query<{ id: string }>(`insert into clients (name) values ('M4') returning id`);
    const clientId = client.rows[0]!.id;
    const list = await pool.query<{ id: string }>(
      `insert into lists (client_id, name, source, file_name, storage_key, size_bytes, columns, total_rows, created_by)
       values ($1, 'l', 'upload', 'a.csv', 'k', 1, '[]', 1, 'test') returning id`,
      [clientId],
    );
    await pool.query(`insert into list_contacts (list_id, client_id, row_number, cells) values ($1, $2, 2, '["1"]')`, [
      list.rows[0]!.id,
      clientId,
    ]);
    await expect(pool.query('delete from clients where id = $1', [clientId])).rejects.toThrow();
    await pool.query('delete from lists where id = $1', [list.rows[0]!.id]);
    expect((await pool.query('select count(*) from list_contacts')).rows[0].count).toBe('0');
  });
});
