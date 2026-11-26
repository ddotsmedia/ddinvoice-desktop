/** Decimal → string for JSON (rule 3: never JS numbers for money). */
export const dec = (v: { toString(): string } | null | undefined): string | null => (v == null ? null : v.toString());
/** Date-only columns → YYYY-MM-DD. */
export const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Shared request-field validators. */
import { z } from 'zod';
export const DecimalString = z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Must be a non-negative decimal string');
export const PercentString = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, 'Must be a percentage decimal string');
export const IsoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
export const Id = z.uuid();
