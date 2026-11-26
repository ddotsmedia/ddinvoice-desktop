import Decimal from 'decimal.js';
import { DomainError } from './errors';
import { Money } from './money';
import { roundAed } from './rounding';

export const BASE_CURRENCY = 'AED';

/** Convert a foreign amount to AED base at rate (AED per 1 unit). */
export function convert(amount: Decimal.Value, rate: Decimal.Value): Decimal {
  const r = new Decimal(rate);
  if (!r.gt(0)) throw new DomainError('INVALID_RATE', 'FX rate must be > 0');
  return roundAed(new Decimal(amount).times(r));
}

export function toBase(m: Money, rate: Decimal.Value): Money {
  return Money.of(m.currency === BASE_CURRENCY ? m.amount : convert(m.amount, rate), BASE_CURRENCY);
}
