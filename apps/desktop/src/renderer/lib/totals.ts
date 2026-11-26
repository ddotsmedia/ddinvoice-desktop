import { Decimal, UAE_TAX_CODES, calcDocument, type TaxCodeId } from '@ddinvoice/domain';

/** Editor line as the user types it. Quantities and prices stay strings; nothing here uses JS numbers for money. */
export interface EditableLine {
  description: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  taxCode: TaxCodeId;
}

export interface DisplayTotals {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  /** Per-line amount (net of tax) for the grid's amount column. */
  lineAmounts: string[];
}

const EMPTY: DisplayTotals = { subtotal: '0.00', discountTotal: '0.00', taxTotal: '0.00', total: '0.00', lineAmounts: [] };

/**
 * Live totals for display only. The server recalculates and is the authority; this keeps the screen in step while typing.
 * Invalid partial input (e.g. "1." or a negative value mid-edit) shows the last valid zero for that line.
 */
export function computeTotals(lines: EditableLine[]): DisplayTotals {
  const valid = lines.filter((l) => isDecimalText(l.qty) && isDecimalText(l.unitPrice) && isDecimalText(l.discountPct || '0'));
  if (lines.length === 0) return EMPTY;
  const inputs = valid.map((l) => ({
    qty: l.qty || '0',
    unitPrice: l.unitPrice || '0',
    discountPct: l.discountPct || '0',
    taxCode: UAE_TAX_CODES[l.taxCode],
  }));
  let result;
  try {
    result = calcDocument(inputs);
  } catch {
    return { ...EMPTY, lineAmounts: lines.map(() => '0.00') };
  }
  const lineAmounts = lines.map((l) => {
    if (!valid.includes(l)) return '0.00';
    const idx = valid.indexOf(l);
    return fmt(result.lines[idx]!.net);
  });
  return {
    subtotal: fmt(result.subtotal),
    discountTotal: fmt(result.discountTotal),
    taxTotal: fmt(result.taxTotal),
    total: fmt(result.total),
    lineAmounts,
  };
}

/** Accepts "", "12", "12.5", "0.000001"; rejects signs, exponents and separators. */
export function isDecimalText(v: string): boolean {
  return /^\d*\.?\d*$/.test(v) && v !== '.';
}

export function fmt(v: Decimal.Value): string {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
