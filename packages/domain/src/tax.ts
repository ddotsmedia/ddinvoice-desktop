import Decimal from 'decimal.js';
import { DomainError } from './errors';
import { roundLine } from './rounding';

export type TaxCodeId = 'SR' | 'ZR' | 'EX' | 'RC' | 'OOS';
export interface TaxCode {
  code: TaxCodeId;
  /** percent, e.g. "5" */
  rate: string;
  label: string;
  /** tax self-assessed, not charged to customer */
  reverseCharge?: boolean;
}

export const UAE_TAX_CODES: Record<TaxCodeId, TaxCode> = {
  SR: { code: 'SR', rate: '5', label: 'Standard rated 5%' },
  ZR: { code: 'ZR', rate: '0', label: 'Zero rated' },
  EX: { code: 'EX', rate: '0', label: 'Exempt' },
  RC: { code: 'RC', rate: '5', label: 'Reverse charge', reverseCharge: true },
  OOS: { code: 'OOS', rate: '0', label: 'Out of scope' },
};

export interface LineInput {
  qty: Decimal.Value;
  unitPrice: Decimal.Value;
  discountPct?: Decimal.Value;
  discountAmt?: Decimal.Value;
  taxCode: TaxCode;
  priceIncludesTax?: boolean;
}
export interface LineResult {
  net: Decimal;
  tax: Decimal;
  /** amount payable by customer for this line (RC: net only) */
  gross: Decimal;
  /** ex-tax discount applied */
  discount: Decimal;
  taxCode: TaxCodeId;
  reverseCharge: boolean;
}

const D100 = new Decimal(100);

export function calcLine(i: LineInput): LineResult {
  const qty = new Decimal(i.qty);
  const price = new Decimal(i.unitPrice);
  const pct = new Decimal(i.discountPct ?? 0);
  const amt = new Decimal(i.discountAmt ?? 0);
  if (qty.isNeg() || price.isNeg()) throw new DomainError('INVALID_LINE', 'qty/price must be >= 0');
  if (pct.isNeg() || pct.gt(100) || amt.isNeg()) throw new DomainError('INVALID_DISCOUNT', 'bad discount');
  const rate = new Decimal(i.taxCode.rate).div(D100);
  const base = qty.times(price);
  const disc = base.times(pct).div(D100).plus(amt);
  if (disc.gt(base)) throw new DomainError('INVALID_DISCOUNT', 'discount exceeds line amount');
  const divisor = i.priceIncludesTax ? rate.plus(1) : new Decimal(1);
  const net = roundLine(base.minus(disc).div(divisor));
  const discount = roundLine(base.div(divisor)).minus(net);
  const tax = i.priceIncludesTax ? roundLine(base.minus(disc)).minus(net) : roundLine(net.times(rate));
  const rc = !!i.taxCode.reverseCharge;
  return { net, tax, gross: rc ? net : net.plus(tax), discount, taxCode: i.taxCode.code, reverseCharge: rc };
}

export interface DocDiscount {
  pct?: Decimal.Value;
  amt?: Decimal.Value;
}
export interface DocResult {
  lines: LineResult[];
  /** ex-tax amount before any discount */
  subtotal: Decimal;
  /** line + document discounts */
  discountTotal: Decimal;
  taxableByCode: Partial<Record<TaxCodeId, Decimal>>;
  taxByCode: Partial<Record<TaxCodeId, Decimal>>;
  /** tax charged to customer (excludes reverse charge) */
  taxTotal: Decimal;
  /** self-assessed reverse-charge tax */
  rcTaxTotal: Decimal;
  total: Decimal;
}

/** Rounds per line, then sums. Doc discount is allocated pro-rata to line nets (remainder on last line). */
export function calcDocument(inputs: LineInput[], docDiscount?: DocDiscount): DocResult {
  let lines = inputs.map(calcLine);
  const sumNet = lines.reduce((s, l) => s.plus(l.net), new Decimal(0));
  const dPct = new Decimal(docDiscount?.pct ?? 0);
  const dAmt = new Decimal(docDiscount?.amt ?? 0);
  if (dPct.isNeg() || dPct.gt(100) || dAmt.isNeg()) throw new DomainError('INVALID_DISCOUNT', 'bad doc discount');
  const docDisc = roundLine(sumNet.times(dPct).div(D100).plus(dAmt));
  if (docDisc.gt(sumNet)) throw new DomainError('INVALID_DISCOUNT', 'document discount exceeds subtotal');
  if (!docDisc.isZero()) {
    let left = docDisc;
    lines = lines.map((l, idx) => {
      const share = idx === lines.length - 1 ? left : roundLine(docDisc.times(l.net).div(sumNet));
      left = left.minus(share);
      const net = l.net.minus(share);
      const rate = new Decimal(inputs[idx]!.taxCode.rate).div(D100);
      const tax = roundLine(net.times(rate));
      return { ...l, net, tax, gross: l.reverseCharge ? net : net.plus(tax), discount: l.discount.plus(share) };
    });
  }
  const taxableByCode: DocResult['taxableByCode'] = {};
  const taxByCode: DocResult['taxByCode'] = {};
  let taxTotal = new Decimal(0);
  let rcTaxTotal = new Decimal(0);
  let net = new Decimal(0);
  let disc = new Decimal(0);
  for (const l of lines) {
    taxableByCode[l.taxCode] = (taxableByCode[l.taxCode] ?? new Decimal(0)).plus(l.net);
    taxByCode[l.taxCode] = (taxByCode[l.taxCode] ?? new Decimal(0)).plus(l.tax);
    if (l.reverseCharge) rcTaxTotal = rcTaxTotal.plus(l.tax);
    else taxTotal = taxTotal.plus(l.tax);
    net = net.plus(l.net);
    disc = disc.plus(l.discount);
  }
  return {
    lines,
    subtotal: net.plus(disc),
    discountTotal: disc,
    taxableByCode,
    taxByCode,
    taxTotal,
    rcTaxTotal,
    total: net.plus(taxTotal),
  };
}
