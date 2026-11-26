import { z } from 'zod';
import { DecimalString, Id, IsoDateString } from '../common/dto';

export const CreateJournalSchema = z.object({
  date: IsoDateString,
  memo: z.string().min(1).max(500),
  lines: z
    .array(z.object({ accountId: Id, debit: DecimalString.default('0'), credit: DecimalString.default('0'), description: z.string().max(500).default('') }))
    .min(2)
    .max(500),
});
export type CreateJournalInput = z.infer<typeof CreateJournalSchema>;
