import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/lib/db.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';
import { createUser } from '../src/modules/auth/users.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');

const pool = createPool(url);
const db = createDb(pool);
const PASSWORD = 'a-long-enough-password';

const createdByOf = async (id: string) =>
  (await pool.query<{ created_by: string | null }>('select created_by from users where id = $1', [id]))
    .rows[0]?.created_by;

beforeAll(async () => {
  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
  await migrate(pool, migrationsDir());
});

afterAll(() => pool.end());

describe.sequential('users.created_by', () => {
  it('records which super admin added a user, separately for each super admin', async () => {
    const first = await createUser(db, { email: 'first@reaplift.com', name: 'First', role: 'super_admin', password: PASSWORD });
    const second = await createUser(db, {
      email: 'second@reaplift.com',
      name: 'Second',
      role: 'super_admin',
      password: PASSWORD,
      createdBy: first.id,
    });
    const staff = await createUser(db, {
      email: 'staff@reaplift.com',
      name: 'Staff',
      role: 'staff',
      password: PASSWORD,
      createdBy: second.id,
    });

    expect(await createdByOf(first.id)).toBeNull();
    expect(await createdByOf(second.id)).toBe(first.id);
    expect(await createdByOf(staff.id)).toBe(second.id);
  });

  it('refuses a created_by that is not a real user', async () => {
    await expect(
      createUser(db, {
        email: 'nobody@reaplift.com',
        name: 'Nobody',
        role: 'staff',
        password: PASSWORD,
        createdBy: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow();
  });
});
