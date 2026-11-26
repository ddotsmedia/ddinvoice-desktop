import Decimal from 'decimal.js';
import { DomainError } from './errors';
import { roundLine } from './rounding';

export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: string,
  ) {}

  static of(amount: Decimal.Value, currency: string): Money {
    return new Money(new Decimal(amount), currency);
  }

  static fromString(s: string, currency: string): Money {
    if (!/^-?\d+(\.\d+)?$/.test(s.trim())) throw new DomainError('INVALID_AMOUNT', `Invalid amount: ${s}`);
    return new Money(new Decimal(s.trim()), currency);
  }

  static assertSameCurrency(a: Money, b: Money): void {
    if (a.currency !== b.currency) throw new DomainError('CURRENCY_MISMATCH', `${a.currency} vs ${b.currency}`);
  }

  add(o: Money): Money {
    Money.assertSameCurrency(this, o);
    return new Money(this.amount.plus(o.amount), this.currency);
  }
  sub(o: Money): Money {
    Money.assertSameCurrency(this, o);
    return new Money(this.amount.minus(o.amount), this.currency);
  }
  mul(f: Decimal.Value): Money {
    return new Money(this.amount.times(f), this.currency);
  }
  round(dp = 2): Money {
    return new Money(roundLine(this.amount, dp), this.currency);
  }
  isZero(): boolean {
    return this.amount.isZero();
  }
  eq(o: Money): boolean {
    return this.currency === o.currency && this.amount.eq(o.amount);
  }
  toString(): string {
    return roundLine(this.amount, 2).toFixed(2);
  }
}
