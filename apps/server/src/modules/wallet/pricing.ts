import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';

export const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type Category = (typeof CATEGORIES)[number];
export type ChargeOutcome = 'blocked' | 'sent_not_delivered' | 'delivered' | 'failed' | 'invalid' | 'duplicate';

const MARKUP_COLUMN = {
  MARKETING: 'markup_marketing_bp',
  UTILITY: 'markup_utility_bp',
  AUTHENTICATION: 'markup_authentication_bp',
} as const;
const FIXED_COLUMN = {
  MARKETING: 'fixed_marketing_paise',
  UTILITY: 'fixed_utility_paise',
  AUTHENTICATION: 'fixed_authentication_paise',
} as const;

/** Meta's rate plus the markup, rounded up to the whole paisa, in whole-number maths only. */
export function markupPrice(rateCentipaise: number, markupBp: number): number {
  const scale = 1_000_000n;
  const total = BigInt(rateCentipaise) * BigInt(10_000 + markupBp);
  return Number((total + scale - 1n) / scale);
}

interface PricingRow {
  mode: 'markup' | 'fixed' | 'default';
  markup_marketing_bp: number | null;
  markup_utility_bp: number | null;
  markup_authentication_bp: number | null;
  fixed_marketing_paise: number | null;
  fixed_utility_paise: number | null;
  fixed_authentication_paise: number | null;
}

async function pricingFor(db: Kysely<Database>, clientId: string): Promise<PricingRow> {
  const own = (
    await sql<PricingRow>`select * from pricing where client_id = ${clientId} order by seq desc limit 1`.execute(db)
  ).rows[0];
  if (own && own.mode !== 'default') return own;
  return (
    await sql<PricingRow>`select * from pricing where client_id is null order by seq desc limit 1`.execute(db)
  ).rows[0]!;
}

/**
 * Brings `price_lists` up to date for one client, or all. A new price is a new row, so history stays. It covers now
 * and each Meta rate that starts later, so a future rate changes prices only from its start date.
 */
export async function recomputePrices(db: Kysely<Database>, at: Date, clientId?: string) {
  const clients = (
    await sql<{ id: string; country_calling_code: string | null }>`
      select id, country_calling_code from clients where ${clientId ? sql`id = ${clientId}` : sql`true`}
    `.execute(db)
  ).rows;

  for (const client of clients) {
    if (!client.country_calling_code) continue;
    const country = client.country_calling_code;
    const pricing = await pricingFor(db, client.id);

    for (const category of CATEGORIES) {
      const later = (
        await sql<{ valid_from: Date }>`
          select distinct valid_from from meta_rates
          where category = ${category} and country_calling_code = ${country} and valid_from > ${at}
          order by valid_from
        `.execute(db)
      ).rows.map((r) => r.valid_from);

      for (const point of [at, ...later]) {
        const rate = (
          await sql<{ id: string; rate_centipaise: number }>`
            select id, rate_centipaise from meta_rates
            where category = ${category} and country_calling_code = ${country} and valid_from <= ${point}
            order by valid_from desc, seq desc limit 1
          `.execute(db)
        ).rows[0];

        const fixed = pricing.mode === 'fixed';
        if (!fixed && !rate) continue; // No Meta rate yet, so no price; a campaign is refused until there is one.
        const price = fixed ? pricing[FIXED_COLUMN[category]]! : markupPrice(rate!.rate_centipaise, pricing[MARKUP_COLUMN[category]]!);
        const source = fixed ? 'fixed' : 'markup';

        const current = (
          await sql<{ price_paise: number; source: string }>`
            select price_paise, source from price_lists
            where client_id = ${client.id} and category = ${category} and country_calling_code = ${country} and valid_from <= ${point}
            order by valid_from desc, id desc limit 1
          `.execute(db)
        ).rows[0];
        if (current?.price_paise === price && current.source === source) continue;

        await sql`
          insert into price_lists (client_id, category, country_calling_code, price_paise, source, meta_rate_id, valid_from)
          values (${client.id}, ${category}, ${country}, ${price}, ${source}, ${fixed ? null : rate!.id}, ${point})
        `.execute(db);
      }
    }
  }
}

/** The client's price for a message type at a moment; null when no price exists yet. */
export async function priceAt(db: Kysely<Database>, clientId: string, category: string, at: Date): Promise<number | null> {
  const row = (
    await sql<{ price_paise: number }>`
      select p.price_paise from price_lists p
      join clients c on c.id = p.client_id and c.country_calling_code = p.country_calling_code
      where p.client_id = ${clientId} and p.category = ${category} and p.valid_from <= ${at}
      order by p.valid_from desc, p.id desc limit 1
    `.execute(db)
  ).rows[0];
  return row?.price_paise ?? null;
}

/** Whether each outcome is charged for this client: its own switch if set, otherwise the one for all clients. */
export async function chargePolicyFor(db: Kysely<Database>, clientId: string): Promise<Record<ChargeOutcome, boolean>> {
  const rows = (
    await sql<{ outcome: ChargeOutcome; charged: boolean }>`
      select distinct on (outcome) outcome, charged from charge_policy
      where client_id = ${clientId} or client_id is null
      order by outcome, client_id nulls last
    `.execute(db)
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.outcome, r.charged])) as Record<ChargeOutcome, boolean>;
}
