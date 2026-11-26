import { z } from 'zod';

export enum ErrorCode {
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  NotFound = 'NOT_FOUND',
  ValidationFailed = 'VALIDATION_FAILED',
  Conflict = 'CONFLICT',
  IdempotencyConflict = 'IDEMPOTENCY_CONFLICT',
  PreconditionFailed = 'PRECONDITION_FAILED',
  VersionConflict = 'VERSION_CONFLICT',
  InvalidCredentials = 'INVALID_CREDENTIALS',
  MfaRequired = 'MFA_REQUIRED',
  AccountLocked = 'ACCOUNT_LOCKED',
  RateLimited = 'RATE_LIMITED',
  ImmutableRecord = 'IMMUTABLE_RECORD',
  PeriodLocked = 'PERIOD_LOCKED',
  IllegalTransition = 'ILLEGAL_TRANSITION',
  JournalUnbalanced = 'JOURNAL_UNBALANCED',
  SeatLimit = 'SEAT_LIMIT',
  LicenseReadOnly = 'LICENSE_READ_ONLY',
  ModuleNotLicensed = 'MODULE_NOT_LICENSED',
  LicenseInvalid = 'LICENSE_INVALID',
  RecoveryMode = 'RECOVERY_MODE',
  Internal = 'INTERNAL',
}

/** Domain rule failures (from @ddinvoice/domain) use their own string codes; this schema accepts both. */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
