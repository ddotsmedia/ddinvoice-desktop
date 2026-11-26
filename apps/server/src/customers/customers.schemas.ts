import { z } from 'zod';
import { Id } from '../common/dto';

export const CreateCustomerSchema = z.object({
  code: z.string().min(1).max(32),
  nameEn: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  trn: z.string().regex(/^\d{15}$/).optional(),
  email: z.email().max(254),
  phone: z.string().min(3).max(32),
  addressEn: z.string().max(500),
  addressAr: z.string().max(500),
  emirate: z.enum(['ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH']).optional(),
  country: z.string().length(2).default('AE'),
  currency: z.string().length(3).default('AED'),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  creditLimit: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).optional(),
  receivableAccountId: Id,
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

export const ListCustomersSchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
