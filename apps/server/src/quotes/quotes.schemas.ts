import { z } from 'zod';
import { Id, IsoDateString } from '../common/dto';
import { InvoiceLineSchema } from '../invoices/invoices.schemas';

export const CreateQuoteSchema = z.object({
  customerId: Id,
  currency: z.string().length(3).default('AED'),
  fxRate: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/).optional(),
  validUntil: IsoDateString.optional(),
  notes: z.string().max(2000).default(''),
  terms: z.string().max(2000).default(''),
  lines: z.array(InvoiceLineSchema).min(1).max(500),
});
export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

export const UpdateQuoteSchema = CreateQuoteSchema.partial();
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteSchema>;
