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

export const ReplaceToken = z.object({ token: z.string().min(1) }).strict();

export const ConnectAccount = z
  .object({ wabaId: z.string().min(1), phoneNumberId: z.string().min(1), token: z.string().min(1) })
  .strict();
