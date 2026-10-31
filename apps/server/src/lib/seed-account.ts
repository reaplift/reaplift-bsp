import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from './db.js';
import { encryptSecret } from './crypto.js';

export type MetaPayer = 'reaplift_card' | 'partner_credit_line' | 'reaplift_credit_line';

export interface SeedAccountInput {
  /** An existing client; without it, a new client is created with `clientName`. */
  clientId?: string;
  clientName?: string;
  contactEmail?: string | null;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string;
  displayName?: string | null;
  accessToken: string;
  metaPayer?: MetaPayer;
  sendRatePerSec?: number;
  status?: 'active' | 'paused';
  pausedReason?: string | null;
  onboardedVia?: 'manual' | 'embedded_signup';
  creditShareRef?: string | null;
  twoStepPin?: string;
  connectedBy?: string | null;
}

export async function seedAccount(
  db: Kysely<Database>,
  input: SeedAccountInput,
  encryptionKey: string,
): Promise<{ clientId: string; waAccountId: string }> {
  // Client names are unique, so a second number for the same client joins it.
  const clientId =
    input.clientId ??
    (
      await sql<{ id: string }>`
        select id from clients where lower(name) = lower(${input.clientName ?? ''})
      `.execute(db)
    ).rows[0]?.id ??
    (
      await sql<{ id: string }>`
        insert into clients (name, contact_email, country_calling_code)
        values (${input.clientName ?? ''}, ${input.contactEmail ?? null}, '91')
        returning id
      `.execute(db)
    ).rows[0]?.id;
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
      status,
      paused_reason,
      credit_share_ref,
      two_step_pin_enc,
      onboarded_via,
      connected_by,
      connected_at
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
      ${input.status ?? 'active'},
      ${input.pausedReason ?? null},
      ${input.creditShareRef ?? null},
      ${input.twoStepPin ? Buffer.from(encryptSecret(input.twoStepPin, encryptionKey), 'utf8') : null},
      ${input.onboardedVia ?? 'manual'},
      ${input.connectedBy ?? null},
      now()
    )
    returning id
  `.execute(db);

  const waAccountId = waAccountResult.rows[0]?.id;
  if (!waAccountId) {
    throw new Error('Failed to create wa_accounts row while seeding the WhatsApp account');
  }

  return { clientId, waAccountId };
}
