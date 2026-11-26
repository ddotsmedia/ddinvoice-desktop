import { z } from 'zod';

export enum ErrorCode {
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  ValidationFailed = 'VALIDATION_FAILED',
  IdempotencyConflict = 'IDEMPOTENCY_CONFLICT',
  ImmutableRecord = 'IMMUTABLE_RECORD',
  JournalUnbalanced = 'JOURNAL_UNBALANCED',
  Internal = 'INTERNAL',
}

export const ApiErrorSchema = z.object({
  code: z.nativeEnum(ErrorCode),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
