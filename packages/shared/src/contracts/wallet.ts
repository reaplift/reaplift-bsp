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

/** GST in basis points (1800 = 18%), from a date. */
export const GstRateCreate = z
  .object({ rateBp: z.number().int().min(0).max(5000), validFrom: z.string().datetime({ offset: true }) })
  .strict();

// Responses. Not strict, so a field the server adds later does not break the panel.
export const WalletView = z.object({
  balancePaise: z.number(),
  onHoldPaise: z.number(),
  availablePaise: z.number(),
  holds: z.array(
    z.object({ campaignId: z.string(), campaignName: z.string(), scheduledAt: z.string().nullable(), amountPaise: z.number() }),
  ),
  lowBalanceAlertPaise: z.number().nullable(),
});

export const LedgerRow = z.object({
  id: z.number(),
  kind: z.enum(['topup', 'adjustment', 'charge', 'refund']),
  amountPaise: z.number(),
  balanceAfterPaise: z.number(),
  campaignId: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;

export const LedgerPage = z.object({ items: z.array(LedgerRow), nextCursor: z.string().nullable() });

export const PriceList = z.object({
  items: z.array(
    z.object({
      category: Category,
      pricePaise: z.number().nullable(),
      gstBp: z.number(),
      priceWithGstPaise: z.number().nullable(),
    }),
  ),
});

export const StatementView = z.object({
  month: z.string(),
  lines: z.array(
    z.object({
      gstBp: z.number(),
      chargedPaise: z.number(),
      refundedPaise: z.number(),
      netPaise: z.number(),
      taxablePaise: z.number(),
      gstPaise: z.number(),
    }),
  ),
});

export const ClientPricingView = z.object({
  pricing: z.object({
    mode: z.enum(['markup', 'fixed', 'default']),
    markupMarketingBp: z.number().nullable().optional(),
    markupUtilityBp: z.number().nullable().optional(),
    markupAuthenticationBp: z.number().nullable().optional(),
    fixedMarketingPaise: z.number().nullable().optional(),
    fixedUtilityPaise: z.number().nullable().optional(),
    fixedAuthenticationPaise: z.number().nullable().optional(),
  }),
  prices: z.array(
    z.object({
      category: Category,
      pricePaise: z.number().nullable(),
      gstBp: z.number(),
      priceWithGstPaise: z.number().nullable(),
      metaRateCentipaise: z.number().nullable(),
      belowCost: z.boolean(),
    }),
  ),
});
export type ClientPricingView = z.infer<typeof ClientPricingView>;

export const MetaRateList = z.object({
  items: z.array(
    z.object({ id: z.string(), category: Category, countryCallingCode: z.string(), rateCentipaise: z.number(), validFrom: z.string() }),
  ),
  nextCursor: z.string().nullable(),
});

export const DefaultPricingView = z.object({
  markupBp: z.object({ marketing: z.number(), utility: z.number(), authentication: z.number() }),
});

export const ChargePolicyView = z.object({ clientId: z.string().nullable(), policy: z.record(ChargeOutcome, z.boolean()) });

export const GstRateList = z.object({
  currentBp: z.number(),
  items: z.array(z.object({ id: z.string(), rateBp: z.number(), validFrom: z.string(), createdAt: z.string() })),
  nextCursor: z.string().nullable(),
});

export const GstReport = z.object({
  month: z.string(),
  lines: z.array(
    z.object({
      clientName: z.string(),
      gstBp: z.number(),
      chargedPaise: z.number(),
      refundedPaise: z.number(),
      netPaise: z.number(),
      taxablePaise: z.number(),
      gstPaise: z.number(),
    }),
  ),
  totals: z.object({ netPaise: z.number(), taxablePaise: z.number(), gstPaise: z.number() }),
});
