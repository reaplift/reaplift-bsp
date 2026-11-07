import { z } from 'zod';

/** Each template variable comes from a column of the list, or is one fixed text for every row (D2). */
export const VariableSource = z.union([
  z.object({ column: z.number().int().min(0) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
]);

export const VariableMap = z.record(z.string().regex(/^[1-9]\d*$/), VariableSource);
export type VariableMap = z.infer<typeof VariableMap>;

export const CampaignCreate = z
  .object({
    name: z.string().trim().min(1),
    templateId: z.string().uuid(),
    listId: z.string().uuid().optional(),
    variableMap: VariableMap.optional(),
  })
  .strict();

export const CampaignEdit = z
  .object({
    name: z.string().trim().min(1).optional(),
    templateId: z.string().uuid().optional(),
    listId: z.string().uuid().nullable().optional(),
    variableMap: VariableMap.optional(),
  })
  .strict();

export const NumberColumn = z.object({ column: z.number().int().min(0) }).strict();

export const OptOutUpload = z.object({ numbers: z.array(z.string()).min(1).max(200000) }).strict();

export const SettingWords = z.object({ value: z.array(z.string().trim().min(1)) }).strict();

export const CampaignSchedule = z.object({ at: z.string().datetime({ offset: true }) }).strict();

const RuleTarget = { clientId: z.string().uuid().nullable().default(null), enabled: z.boolean() };

export const RuleUpdate = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('repeat_within_hours'),
      values: z.object({ hours: z.number().int().positive().max(8760) }).strict(),
      ...RuleTarget,
    })
    .strict(),
  z
    .object({
      type: z.literal('marketing_cap'),
      values: z.object({ count: z.number().int().positive(), period: z.enum(['day', 'week']) }).strict(),
      ...RuleTarget,
    })
    .strict(),
]);

/** What the Rules screen sends; `clientId` may be left out for all clients. */
export type RuleInput = z.input<typeof RuleUpdate>;

// Responses. Not strict, so a field the server adds later does not break the panel.
export const AudienceUploaded = z.object({ id: z.string(), rowCount: z.number(), blankRowsSkipped: z.number(), columns: z.array(z.string()) });

export const AudienceList = z.object({
  id: z.string(),
  fileName: z.string(),
  rowCount: z.number(),
  blankRowsSkipped: z.number(),
  columns: z.array(z.string()),
  numberColumn: z.number().nullable(),
  validCount: z.number().nullable(),
  invalidCount: z.number().nullable(),
  duplicateCount: z.number().nullable(),
  preview: z.array(z.array(z.string().nullable())),
});
export type AudienceList = z.infer<typeof AudienceList>;

const DeliveryEstimate = z.object({
  messagesAhead: z.number(),
  seconds: z.number(),
  finishesAt: z.string(),
  waitsForDailyLimit: z.boolean(),
});

export const CampaignView = z.object({
  id: z.string(),
  name: z.string(),
  templateId: z.string(),
  listId: z.string().nullable(),
  variableMap: VariableMap,
  status: z.string(),
  total: z.number().nullable(),
  blocked: z.number().nullable(),
  sent: z.number().nullable(),
  delivered: z.number().nullable(),
  read: z.number().nullable(),
  failed: z.number().nullable(),
  scheduledAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CampaignView = z.infer<typeof CampaignView>;

export const CampaignList = z.object({ items: z.array(CampaignView), nextCursor: z.string().nullable() });

export const CampaignDetail = CampaignView.extend({
  estimate: DeliveryEstimate.nullable(),
  chargedPaise: z.number(),
  refundedPaise: z.number(),
  failures: z.array(z.object({ code: z.number().nullable(), reason: z.string().nullable(), count: z.number(), label: z.string() })),
});
export type CampaignDetail = z.infer<typeof CampaignDetail>;

export const CampaignSummary = z.object({
  total: z.number(),
  willSend: z.number(),
  blocked: z.object({ total: z.number(), byReason: z.record(z.number()) }),
  invalid: z.object({ total: z.number(), byReason: z.record(z.number()) }),
  duplicate: z.number(),
  pricePaise: z.number(),
  gstBp: z.number(),
  priceWithGstPaise: z.number(),
  chargePaise: z.number(),
  availablePaise: z.number(),
  balancePaise: z.number(),
  balanceAfterPaise: z.number(),
  limitWarning: z.object({ limit: z.number() }).nullable(),
  estimate: DeliveryEstimate,
});
export type CampaignSummary = z.infer<typeof CampaignSummary>;

// M8: campaign controls, rules and the super admin's campaign view.
export const CampaignCancelled = z.object({ status: z.literal('cancelled'), cancelled: z.number(), refundPaise: z.number() });
export type CampaignCancelled = z.infer<typeof CampaignCancelled>;

export const CampaignScheduled = z.object({
  status: z.literal('scheduled'),
  scheduledAt: z.string(),
  heldPaise: z.number(),
  estimate: DeliveryEstimate,
});
export type CampaignScheduled = z.infer<typeof CampaignScheduled>;

export const RuleView = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  type: z.string(),
  values: z.record(z.unknown()),
  enabled: z.boolean(),
  updatedAt: z.string(),
});
export type RuleView = z.infer<typeof RuleView>;
export const RuleList = z.object({ items: z.array(RuleView), nextCursor: z.string().nullable() });

export const AdminCampaign = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  name: z.string(),
  status: z.string(),
  total: z.number().nullable(),
  sent: z.number().nullable(),
  delivered: z.number().nullable(),
  read: z.number().nullable(),
  failed: z.number().nullable(),
  blocked: z.number().nullable(),
  scheduledAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminCampaign = z.infer<typeof AdminCampaign>;
export const AdminCampaignList = z.object({ items: z.array(AdminCampaign), nextCursor: z.string().nullable() });

export const CampaignDiagnosis = z.object({
  status: z.string(),
  headline: z.string(),
  reasons: z.array(z.object({ code: z.string(), message: z.string() })),
  queue: z.object({ waiting: z.number(), sending: z.number(), aheadOnNumber: z.number() }),
  limits: z.object({
    sendRatePerSec: z.number(),
    dailyLimit: z.number().nullable(),
    dailySetting: z.number().nullable(),
    metaLimit: z.string().nullable(),
    remainingToday: z.number().nullable(),
  }),
  estimate: DeliveryEstimate.nullable(),
  failures: z.array(z.object({ code: z.number().nullable(), reason: z.string().nullable(), count: z.number() })),
});
export type CampaignDiagnosis = z.infer<typeof CampaignDiagnosis>;

export const OptOutList = z.object({
  items: z.array(z.object({ number: z.string(), source: z.string(), createdAt: z.string() })),
  nextCursor: z.string().nullable(),
});
export const OptOutsAdded = z.object({ added: z.number(), invalid: z.number() });
