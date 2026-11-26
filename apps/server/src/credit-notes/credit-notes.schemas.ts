import { z } from 'zod';
import { Id } from '../common/dto';
import { InvoiceLineSchema } from '../invoices/invoices.schemas';

export const CreateCreditNoteSchema = z.object({
  invoiceId: Id,
  reason: z.string().min(1).max(500),
  lines: z.array(InvoiceLineSchema).min(1).max(500),
});
export type CreateCreditNoteInput = z.infer<typeof CreateCreditNoteSchema>;
