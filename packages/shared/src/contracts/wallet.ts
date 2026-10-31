import { z } from 'zod';

const Paise = z.number().int().safe();
const MarkupBp = z.number().int().min(0).max(100000);
const Category = z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']);

export const MetaRateCreate = z
  .object({
    category: Category,
    countryCallingCode: z.enum(['91']),
    rateCentipaise: Paise.nonnegative(),
    validFrom: z.string().datetime(),
  })
  .strict();

const PerCategory = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ marketing: value, utility: value, authentication: value }).strict();

export const DefaultPricing = z.object({ markupBp: PerCategory(MarkupBp) }).strict();

/** Per client, either a markup or a fixed price for each message type; `default` returns the client to the default. */
export const ClientPricing = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('markup'), markupBp: PerCategory(MarkupBp) }).strict(),
  z.object({ mode: z.literal('fixed'), fixedPaise: PerCategory(Paise.nonnegative()) }).strict(),
  z.object({ mode: z.literal('default') }).strict(),
]);

export const ChargeOutcome = z.enum(['blocked', 'sent_not_delivered', 'delivered', 'failed', 'invalid', 'duplicate']);

export const ChargePolicyUpdate = z
  .object({ clientId: z.string().uuid().nullable().default(null), outcome: ChargeOutcome, charged: z.boolean() })
  .strict();

export const TopUp = z.object({ amountPaise: Paise.positive(), note: z.string().trim().optional() }).strict();

export const Adjustment = z
  .object({ amountPaise: Paise.refine((n) => n !== 0), note: z.string().trim().min(1) })
  .strict();

export const LowBalanceAlert = z.object({ alertPaise: Paise.nonnegative().nullable() }).strict();

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const MetaInvoiceCreate = z
  .object({
    month: Month,
    totalPaise: Paise.nonnegative(),
    perAccount: z.record(z.string(), Paise.nonnegative()).optional(),
  })
  .strict();

export const CreditLimit = z.object({ limitPaise: Paise.positive() }).strict();
