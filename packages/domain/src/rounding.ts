import Decimal from 'decimal.js';

Decimal.set({ precision: 40 });

/** Round to dp (default 2), half-up (away from zero on ties). */
export const roundLine = (v: Decimal.Value, dp = 2): Decimal =>
  new Decimal(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

/** Document-level rounding: same rule as lines. */
export const roundDoc = (v: Decimal.Value, dp = 2): Decimal => roundLine(v, dp);

/** AED rounding: 2dp, half-up. */
export const roundAed = (v: Decimal.Value): Decimal => roundLine(v, 2);
