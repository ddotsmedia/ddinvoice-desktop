import { z } from 'zod';
import { DecimalString, Id, IsoDateString } from '../common/dto';

const Allocation = z.object({ invoiceId: Id, amount: DecimalString });

export const CreatePaymentSchema = z.object({
  customerId: Id,
  date: IsoDateString,
  method: z.enum(['CASH', 'BANK', 'CARD', 'CHEQUE']),
  bankAccountId: Id,
  amount: DecimalString,
  currency: z.string().length(3).default('AED'),
  reference: z.string().max(200).default(''),
  allocations: z.array(Allocation).max(200).optional(),
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

export const AllocatePaymentSchema = z.object({ allocations: z.array(Allocation).min(1).max(200).optional() });
export type AllocateInput = z.infer<typeof AllocatePaymentSchema>;
