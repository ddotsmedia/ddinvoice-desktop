import { z } from 'zod';
import { DecimalString, Id, IsoDateString, PercentString } from '../common/dto';

export const InvoiceLineSchema = z.object({
  itemId: Id.optional(),
  description: z.string().min(1).max(500).optional(),
  qty: DecimalString,
  unitPrice: DecimalString.optional(),
  discountPct: PercentString.optional(),
  discountAmt: DecimalString.optional(),
  taxCodeId: Id.optional(),
  accountId: Id.optional(),
});
export type InvoiceLineInput = z.infer<typeof InvoiceLineSchema>;

export const CreateInvoiceSchema = z.object({
  customerId: Id,
  branchId: Id.optional(),
  currency: z.string().length(3).default('AED'),
  fxRate: DecimalString.optional(),
  supplyDate: IsoDateString.optional(),
  notes: z.string().max(2000).default(''),
  terms: z.string().max(2000).default(''),
  lines: z.array(InvoiceLineSchema).min(1).max(500),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = CreateInvoiceSchema.partial();
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

export const ListInvoicesSchema = z.object({
  status: z.enum(['DRAFT', 'ISSUED']).optional(),
  settlement: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID']).optional(),
  customerId: Id.optional(),
  from: IsoDateString.optional(),
  to: IsoDateString.optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['createdAt', 'issueDate', 'total', 'number']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesSchema>;
