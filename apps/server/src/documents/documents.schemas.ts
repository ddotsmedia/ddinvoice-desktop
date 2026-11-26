import { z } from 'zod';

export const DocTypeSchema = z.enum(['INVOICE', 'CREDIT_NOTE']);
export const LangSchema = z.enum(['en', 'ar', 'bi']);

export const ArchivedPdfQuery = z.object({ lang: LangSchema.default('en') });
export type ArchivedPdfQuery = z.infer<typeof ArchivedPdfQuery>;

export const PreviewSchema = z.object({
  docType: z.literal('INVOICE'),
  docId: z.uuid(),
  lang: LangSchema.default('en'),
});
export type PreviewInput = z.infer<typeof PreviewSchema>;
