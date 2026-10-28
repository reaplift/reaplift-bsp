// Adds two test clients to the local database so lists can be uploaded from the panel
// before M2.3 moves client creation onto the clients table. Safe to run more than once.
import { createPool } from '../src/lib/db.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set; copy .env.example to .env');

const pool = createPool(url);
for (const [name, email] of [
  ['ReapLift Test Client', 'test-client@reaplift.ai'],
  ['Second Test Client', 'second-client@reaplift.ai'],
]) {
  await pool.query(
    `insert into clients (name, contact_email)
     select $1::text, $2::text where not exists (select 1 from clients where name = $1::text)`,
    [name, email],
  );
}
const { rows } = await pool.query('select id, name, status from clients order by name');
console.table(rows);
await pool.end();
