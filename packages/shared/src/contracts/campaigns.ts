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
