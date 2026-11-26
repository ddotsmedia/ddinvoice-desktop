import Decimal from 'decimal.js';

Decimal.set({ precision: 40 });

/** AED rounding: 2dp, half-up. */
export const roundAed = (v: Decimal.Value): Decimal => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
