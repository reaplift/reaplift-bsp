import { z } from 'zod';

/** A template's parts, in the shape Meta's template API uses, so what is saved is what is submitted. */
export const TemplateButton = z
  .object({
    type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']),
    text: z.string(),
    url: z.string().optional(),
    phone_number: z.string().optional(),
    example: z.array(z.string()).optional(),
  })
  .strict();

export const TemplateComponent = z
  .object({
    type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
    format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']).optional(),
    text: z.string().optional(),
    example: z
      .object({
        header_text: z.array(z.string()).optional(),
        header_handle: z.array(z.string()).optional(),
        body_text: z.array(z.array(z.string())).optional(),
      })
      .strict()
      .optional(),
    buttons: z.array(TemplateButton).optional(),
  })
  .strict();
export type TemplateComponent = z.infer<typeof TemplateComponent>;

export const TemplateCategory = z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']);

export const TemplateEdit = z
  .object({
    name: z.string().min(1),
    language: z.string().min(1),
    category: TemplateCategory,
    components: z.array(TemplateComponent),
  })
  .strict();
export type TemplateEdit = z.infer<typeof TemplateEdit>;

export const TemplateCreate = TemplateEdit.extend({ waAccountId: z.string().uuid() }).strict();

export const TemplateCopy = z.object({ name: z.string().min(1) }).strict();

/** One local rule that failed: which field, what is wrong, and how to fix it. */
export const TemplateFailure = z.object({
  rule: z.string(),
  field: z.string(),
  message: z.string(),
  fix: z.string(),
});
export type TemplateFailure = z.infer<typeof TemplateFailure>;

export const EmbeddedSignup = z
  .object({ code: z.string().min(1), wabaId: z.string().min(1), phoneNumberId: z.string().min(1) })
  .strict();

/** Both are for the super admin to change; a null daily limit leaves only Meta's. */
export const SendLimits = z
  .object({
    sendRatePerSec: z.number().int().min(1).max(1000).optional(),
    dailySendLimit: z.number().int().min(1).nullable().optional(),
  })
  .strict()
  .refine((body) => body.sendRatePerSec !== undefined || body.dailySendLimit !== undefined);

export const ReplaceToken = z.object({ token: z.string().min(1) }).strict();

export const ConnectAccount = z
  .object({ wabaId: z.string().min(1), phoneNumberId: z.string().min(1), token: z.string().min(1) })
  .strict();

// Responses. Not strict, so a field the server adds later does not break the panel.
export const WaAccount = z.object({
  id: z.string(),
  clientId: z.string(),
  wabaId: z.string(),
  phoneNumberId: z.string(),
  displayPhone: z.string(),
  displayName: z.string().nullable(),
  qualityRating: z.string().nullable(),
  messagingLimit: z.string().nullable(),
  sendRatePerSec: z.number(),
  dailySendLimit: z.number().nullable(),
  metaPayer: z.string(),
  status: z.enum(['active', 'paused']),
  pausedReason: z.string().nullable(),
  onboardedVia: z.string().nullable(),
  connectedAt: z.string().nullable(),
});
export type WaAccount = z.infer<typeof WaAccount>;

export const WaAccountList = z.object({ items: z.array(WaAccount), nextCursor: z.string().nullable() });

export const LimitUsageRow = z.object({
  waAccountId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  displayPhone: z.string(),
  wabaId: z.string(),
  status: z.string(),
  sendRatePerSec: z.number(),
  sentPerSecLastMinute: z.number(),
  dailySendLimit: z.number().nullable(),
  metaLimit: z.string().nullable(),
  effectiveDailyLimit: z.number().nullable(),
  usedLast24Hours: z.number(),
  remaining: z.number().nullable(),
  usedPercent: z.number().nullable(),
  waiting: z.number(),
});

export const LimitUsage = z.object({
  items: z.array(LimitUsageRow),
  overall: z.object({
    numbers: z.number(),
    pausedNumbers: z.number(),
    usedLast24Hours: z.number(),
    waiting: z.number(),
    sentPerSecLastMinute: z.number(),
    numbersAtDailyLimit: z.number(),
  }),
});

export const TemplateView = z.object({
  id: z.string(),
  waAccountId: z.string(),
  metaTemplateId: z.string().nullable(),
  name: z.string(),
  language: z.string(),
  category: TemplateCategory,
  components: z.array(TemplateComponent),
  variableCount: z.number().optional(),
  status: z.string(),
  validationErrors: z.array(TemplateFailure).nullable(),
  rejectionReason: z.string().nullable(),
  metaRecommendation: z.string().nullable(),
  rejectionExplanation: z.string().nullable(),
  updatedAt: z.string(),
});
export type TemplateView = z.infer<typeof TemplateView>;

export const TemplateList = z.object({ items: z.array(TemplateView), nextCursor: z.string().nullable() });

export const WordSetting = z.object({ key: z.string(), value: z.array(z.string()) });
