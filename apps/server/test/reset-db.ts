import type pg from 'pg';

/**
 * Empties the database so a test can migrate from scratch. Dropping the whole schema
 * means a new migration never needs a matching `drop table` line in every test.
 */
export async function resetDb(pool: pg.Pool) {
  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
}
