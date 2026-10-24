import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { encryptSecret } from './crypto.js';

export type MetaPayer = 'reaplift_card' | 'partner_credit_line' | 'reaplift_credit_line';

export interface SeedAccountInput {
  clientName: string;
  contactEmail?: string | null;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName?: string | null;
  accessToken: string;
  metaPayer?: MetaPayer;
  sendRatePerSec?: number;
  status?: 'active' | 'paused';
}

export async function seedAccount(
  db: Kysely<any>,
  input: SeedAccountInput,
  encryptionKey: string,
): Promise<{ clientId: string; waAccountId: string }> {
  const clientResult = await sql<{ id: string }>`
    insert into clients (name, contact_email)
    values (${input.clientName}, ${input.contactEmail ?? null})
    returning id
  `.execute(db);

  const clientId = clientResult.rows[0]?.id;
  if (!clientId) {
    throw new Error('Failed to create client row while seeding the WhatsApp account');
  }

  const waAccountResult = await sql<{ id: string }>`
    insert into wa_accounts (
      client_id,
      waba_id,
      phone_number_id,
      display_phone,
      display_name,
      access_token_enc,
      meta_payer,
      send_rate_per_sec,
      status
    )
    values (
      ${clientId},
      ${input.wabaId},
      ${input.phoneNumberId},
      ${input.displayPhone},
      ${input.displayName ?? null},
      ${Buffer.from(encryptSecret(input.accessToken, encryptionKey), 'utf8')},
      ${input.metaPayer ?? 'reaplift_card'},
      ${input.sendRatePerSec ?? 20},
      ${input.status ?? 'active'}
    )
    returning id
  `.execute(db);

  const waAccountId = waAccountResult.rows[0]?.id;
  if (!waAccountId) {
    throw new Error('Failed to create wa_accounts row while seeding the WhatsApp account');
  }

  return { clientId, waAccountId };
}
