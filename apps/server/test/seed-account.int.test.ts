import { afterAll, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/lib/db.js';
import { decryptSecret } from '../src/lib/crypto.js';
import { seedAccount } from '../src/lib/seed-account.js';
import { migrate } from '../src/migrate/runner.js';
import { migrationsDir } from '../src/modes/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');

const pool = createPool(url);
const db = createDb(pool);

afterAll(() => pool.end());

describe.sequential('seedAccount', () => {
  it('creates a client and encrypted wa account row', async () => {
    // Start from an empty schema so new tables from later migrations never block the reset.
    await pool.query('drop schema public cascade');
    await pool.query('create schema public');

    await migrate(pool, migrationsDir());

    const key = '12345678901234567890123456789012';
    const token = 'meta-access-token-for-seed-test';

    const result = await seedAccount(
      db,
      {
        clientName: 'Acme Labs',
        contactEmail: 'ops@acme.test',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
        displayPhone: '919812345678',
        displayName: 'Acme WhatsApp',
        accessToken: token,
        metaPayer: 'reaplift_card',
      },
      key,
    );

    const clientRow = await pool.query<{ name: string }>('select name from clients where id = $1', [result.clientId]);
    const accountRow = await pool.query<{ display_phone: string; access_token_enc: Buffer }>(`
      select display_phone, access_token_enc
      from wa_accounts
      where id = $1
    `, [result.waAccountId]);

    expect(clientRow.rows[0]?.name).toBe('Acme Labs');
    expect(accountRow.rows[0]?.display_phone).toBe('919812345678');
    expect(accountRow.rows[0]?.access_token_enc.toString('utf8')).not.toContain(token);
    const stored = accountRow.rows[0]?.access_token_enc.toString('utf8');
    expect(stored).toBeTruthy();
    expect(() => decryptSecret(stored!, key)).not.toThrow();
    expect(decryptSecret(stored!, key)).toBe(token);
  });
});
