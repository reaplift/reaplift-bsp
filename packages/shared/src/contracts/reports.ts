import { z } from 'zod';

// M9 responses. Not strict, so a field the server adds later does not break the panel.

const Tile = z.object({ messages: z.number(), spendPaise: z.number() });

/** GET /api/clients/:clientId/dashboard. Never carries Meta's cost or margin. */
export const DashboardView = z.object({
  tiles: z.object({ yesterday: Tile, last15Days: Tile, thisMonth: Tile, lastMonth: Tile }),
  chart: z.array(
    z.object({ date: z.string(), messages: z.number(), delivered: z.number(), read: z.number(), failed: z.number() }),
  ),
  accounts: z.array(
    z.object({
      displayPhone: z.string(),
      displayName: z.string().nullable(),
      qualityRating: z.string().nullable(),
      messagingLimit: z.string().nullable(),
      status: z.string(),
      pausedReason: z.string().nullable(),
    }),
  ),
});
export type DashboardView = z.infer<typeof DashboardView>;

/** Dovesoft's `SummaryDataMonthWise` headings, in its order. */
export const MONTHLY_REPORT_COLUMNS = [
  'Sr No.',
  'Month',
  'Year',
  'User Id',
  'Campaign Name',
  'Total Count',
  'Pending',
  'Failed',
  'Blocked',
  'Sent',
  'Delivered',
  'Not Delivered',
  'DR Not Available',
  'Read Count',
  'Total Unit',
] as const;

/** GET /api/clients/:clientId/reports/monthly?month=YYYY-MM. One row per campaign confirmed that month. */
export const MonthlyReport = z.object({
  columns: z.array(z.string()),
  items: z.array(z.record(z.union([z.string(), z.number()]))),
});
export type MonthlyReport = z.infer<typeof MonthlyReport>;

/** GET /api/admin/meta-view?month=YYYY-MM. Super admin only. */
export const MetaView = z.object({
  month: z.string(),
  clients: z.array(
    z.object({
      clientId: z.string(),
      name: z.string(),
      billedPaise: z.number(),
      gstPaise: z.number(),
      metaCostPaise: z.number(),
      marginPaise: z.number(),
      accounts: z.array(
        z.object({
          displayPhone: z.string(),
          qualityRating: z.string().nullable(),
          messagingLimit: z.string().nullable(),
          status: z.string(),
        }),
      ),
    }),
  ),
  errors: z.array(
    z.object({ clientId: z.string(), code: z.number().nullable(), reason: z.string().nullable(), count: z.number() }),
  ),
  creditLine: z.object({ limitPaise: z.number(), usedPaise: z.number(), usedPercent: z.number() }).nullable(),
});
export type MetaView = z.infer<typeof MetaView>;

/** GET /api/admin/meta-invoices. */
export const MetaInvoiceList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      month: z.string(),
      totalPaise: z.number(),
      perAccount: z.record(z.number()).nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/** POST /api/admin/meta-invoices: the check of Meta's invoice against the cost we recorded. */
export const MetaInvoiceCheck = z.object({
  id: z.string(),
  month: z.string(),
  invoicePaise: z.number(),
  recordedPaise: z.number(),
  differencePaise: z.number(),
  differencePercent: z.number(),
  mismatch: z.boolean(),
  largestDifferences: z.array(
    z.object({ wabaId: z.string(), invoicePaise: z.number(), recordedPaise: z.number(), differencePaise: z.number() }),
  ),
});
export type MetaInvoiceCheck = z.infer<typeof MetaInvoiceCheck>;
