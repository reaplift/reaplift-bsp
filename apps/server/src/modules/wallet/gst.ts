import { sql, type Kysely } from 'kysely';
import type { Database } from '../../lib/db.js';

const TIME_ZONE = 'Asia/Kolkata';
const WHOLE_BP = 10_000n;

/** A price with GST, rounded up to a whole paisa, in whole-number maths only. */
export function priceWithGst(pricePaise: number, gstBp: number): number {
  const total = BigInt(pricePaise) * (WHOLE_BP + BigInt(gstBp));
  return Number((total + WHOLE_BP - 1n) / WHOLE_BP);
}

/** Splits an amount that includes GST, so GST is exactly the rate on what remains, to the nearest paisa. */
export function splitGst(totalPaise: number, gstBp: number): { taxablePaise: number; gstPaise: number } {
  const total = BigInt(totalPaise);
  const whole = WHOLE_BP + BigInt(gstBp);
  const taxablePaise = Number((total * WHOLE_BP * 2n + whole) / (whole * 2n));
  return { taxablePaise, gstPaise: totalPaise - taxablePaise };
}

/** The only country with a tax rate at launch. */
export const HOME_COUNTRY = '91';

/** The rate in force in a country at a moment. */
export async function gstRateAt(db: Kysely<Database>, country: string, at: Date): Promise<number> {
  const row = (
    await sql<{ rate_bp: number }>`
      select rate_bp from gst_rates
      where country_calling_code = ${country} and valid_from <= ${at}
      order by valid_from desc, seq desc limit 1
    `.execute(db)
  ).rows[0];
  if (!row) throw new Error(`no tax rate is set for country ${country}`);
  return row.rate_bp;
}

export interface GstLine {
  clientId: string;
  clientName: string;
  gstBp: number;
  chargedPaise: number;
  refundedPaise: number;
  netPaise: number;
  taxablePaise: number;
  gstPaise: number;
}

/**
 * Charges and refunds in a month, in India time, per client and per rate. Top-ups and adjustments are not sales, so
 * they are left out. GST is split on the net, so a refund reduces it.
 */
export async function readGstLines(db: Kysely<Database>, month: string, clientId?: string): Promise<GstLine[]> {
  const rows = (
    await sql<{ client_id: string; name: string; gst_bp: number; charged: number; refunded: number }>`
      select l.client_id, c.name, l.gst_bp,
        coalesce(-sum(l.amount_paise) filter (where l.kind = 'charge'), 0)::bigint as charged,
        coalesce(sum(l.amount_paise) filter (where l.kind = 'refund'), 0)::bigint as refunded
      from wallet_ledger l
      join clients c on c.id = l.client_id
      where l.kind in ('charge', 'refund') and l.gst_bp is not null
        and to_char(l.created_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
        and ${clientId ? sql`l.client_id = ${clientId}` : sql`true`}
      group by l.client_id, c.name, l.gst_bp
      order by c.name, l.gst_bp
    `.execute(db)
  ).rows;
  return rows.map((row) => {
    const netPaise = row.charged - row.refunded;
    return {
      clientId: row.client_id,
      clientName: row.name,
      gstBp: row.gst_bp,
      chargedPaise: row.charged,
      refundedPaise: row.refunded,
      netPaise,
      ...splitGst(netPaise, row.gst_bp),
    };
  });
}
