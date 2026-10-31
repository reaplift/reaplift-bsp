import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';
import type { MetaClient, MetaFailure, MetaTemplate } from '../../lib/meta-client.js';
import { seedAccount, type SeedAccountInput } from '../../lib/seed-account.js';
import { UserInputError } from '../auth/users.js';

const TEMPLATE_CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);

const describe = (failure: MetaFailure) =>
  `Meta refused: ${failure.title}${failure.code === undefined ? '' : ` (code ${failure.code})`}`;

/** Distinct `{{n}}` placeholders in the template's header and body. */
export function countVariables(components: unknown[] = []): number {
  const names = new Set<string>();
  for (const component of components as Array<{ type?: string; text?: string }>) {
    if (component.type !== 'HEADER' && component.type !== 'BODY') continue;
    for (const match of (component.text ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)) names.add(match[1]!);
  }
  return names.size;
}

interface SyncAccount {
  id: string;
  clientId: string;
  wabaId: string;
}

/** Copies the account's templates from Meta. Running it again updates the same rows. */
export async function syncTemplates(
  db: Kysely<Database>,
  meta: MetaClient,
  account: SyncAccount,
  token: string,
): Promise<{ saved: number; skipped: string[] }> {
  const result = await meta.listTemplates(account.wabaId, token);
  if (!result.ok) throw new UserInputError(describe(result));

  const usable: MetaTemplate[] = result.data.filter((t) => TEMPLATE_CATEGORIES.has(t.category));
  for (const template of usable) {
    await sql`
      insert into templates (
        client_id, wa_account_id, meta_template_id, name, language, category, components,
        variable_count, status
      )
      values (
        ${account.clientId}, ${account.id}, ${template.id}, ${template.name}, ${template.language},
        ${template.category}, ${JSON.stringify(template.components ?? [])}::jsonb,
        ${countVariables(template.components)}, ${template.status}
      )
      on conflict (wa_account_id, name, language) do update set
        meta_template_id = excluded.meta_template_id, category = excluded.category,
        components = excluded.components, variable_count = excluded.variable_count,
        status = excluded.status, updated_at = now()
      where templates.status not in ('DRAFT', 'VALIDATION_FAILED', 'SUBMITTING')
    `.execute(db);
  }
  return {
    saved: usable.length,
    skipped: result.data.filter((t) => !usable.includes(t)).map((t) => t.name),
  };
}

export interface ConnectAccountInput {
  /** An existing client; without it, a new client is created with `clientName`. */
  clientId?: string;
  clientName?: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  connectedBy?: string | null;
  /** Embedded Signup's extras; a manual connection leaves them out. */
  seed?: Pick<
    SeedAccountInput,
    'metaPayer' | 'status' | 'pausedReason' | 'onboardedVia' | 'creditShareRef' | 'twoStepPin'
  >;
}

/** Tests the IDs and token against Meta before saving anything, then copies the templates. */
export async function connectAccount(
  db: Kysely<Database>,
  meta: MetaClient,
  input: ConnectAccountInput,
  encryptionKey: string,
) {
  const numbers = await meta.listPhoneNumbers(input.wabaId, input.token);
  if (!numbers.ok) throw new UserInputError(describe(numbers));
  const phone = numbers.data.data.find((n) => n.id === input.phoneNumberId);
  if (!phone) {
    throw new UserInputError(`phone number ${input.phoneNumberId} is not on WhatsApp account ${input.wabaId}`);
  }

  let ids: { clientId: string; waAccountId: string };
  try {
    ids = await db.transaction().execute((trx) =>
      seedAccount(
        trx,
        {
          clientId: input.clientId,
          clientName: input.clientName,
          connectedBy: input.connectedBy,
          ...input.seed,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhone: (phone.display_phone_number ?? '').replace(/\D/g, ''),
          displayName: phone.verified_name ?? null,
          accessToken: input.token,
        },
        encryptionKey,
      ),
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new UserInputError(`phone number ${input.phoneNumberId} is already connected`);
    }
    throw err;
  }

  const templates = await syncTemplates(
    db,
    meta,
    { id: ids.waAccountId, clientId: ids.clientId, wabaId: input.wabaId },
    input.token,
  );

  // So the account box is complete at once; if this fails, the hourly sync fills it in.
  const health = await meta.phoneHealth(input.phoneNumberId, input.token);
  if (health.ok) {
    await sql`
      update wa_accounts
      set quality_rating = ${health.data.quality_rating ?? null},
        messaging_limit = ${health.data.whatsapp_business_manager_messaging_limit ?? null}
      where id = ${ids.waAccountId}
    `.execute(db);
  }
  return { ...ids, templates };
}

export interface QueueTestInput {
  to: string;
  template: string;
  language: string;
  variables: string[];
  phoneNumberId?: string;
}

/** Queues one template message with source `cli`. */
export async function queueTestMessage(db: Kysely<Database>, input: QueueTestInput): Promise<number> {
  if (!/^[1-9]\d{9,14}$/.test(input.to)) {
    throw new UserInputError('--to must be digits with the country code and no plus, like 919812345678');
  }

  const accounts = (
    await sql<{ id: string; client_id: string }>`
      select id, client_id from wa_accounts
      where ${input.phoneNumberId ? sql`phone_number_id = ${input.phoneNumberId}` : sql`true`}
    `.execute(db)
  ).rows;
  if (accounts.length !== 1) {
    throw new UserInputError(`${accounts.length} WhatsApp accounts match; pick one with --phone-number-id`);
  }
  const account = accounts[0]!;

  const template = (
    await sql<{ id: string; status: string; variable_count: number }>`
      select id, status, variable_count from templates
      where wa_account_id = ${account.id} and name = ${input.template} and language = ${input.language}
    `.execute(db)
  ).rows[0];
  if (!template) throw new UserInputError(`no template ${input.template} (${input.language}) on this account`);
  if (template.status !== 'APPROVED') {
    throw new UserInputError(`template ${input.template} is ${template.status}, not APPROVED`);
  }
  if (template.variable_count !== input.variables.length) {
    throw new UserInputError(
      `template ${input.template} needs ${template.variable_count} --var values, got ${input.variables.length}`,
    );
  }

  const inserted = await sql<{ id: number }>`
    insert into messages (client_id, wa_account_id, template_id, to_number, variables, source)
    values (
      ${account.client_id}, ${account.id}, ${template.id}, ${input.to},
      ${JSON.stringify(input.variables)}::jsonb, 'cli'
    )
    returning id
  `.execute(db);
  return inserted.rows[0]!.id;
}

/** One message and every status Meta reported, for `cli show-message`. */
export async function readMessage(db: Kysely<Database>, id: number) {
  const message = (
    await sql<Record<string, unknown> & { meta_message_id: string | null }>`
      select id, status, to_number, attempts, meta_message_id, queued_at, sent_at, delivered_at, read_at,
        failed_at, failure_reason, meta_error_code, pricing_category, billable
      from messages where id = ${id}
    `.execute(db)
  ).rows[0];
  if (!message) return null;
  const statuses = message.meta_message_id
    ? (
        await sql<{ status: string; meta_timestamp: Date }>`
          select status, meta_timestamp from message_status_events
          where meta_message_id = ${message.meta_message_id}
          order by meta_timestamp, status
        `.execute(db)
      ).rows
    : [];
  return { message, statuses };
}
