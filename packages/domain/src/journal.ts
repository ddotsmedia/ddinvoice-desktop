import Decimal from 'decimal.js';
import { DomainError } from './errors';
import { convert } from './fx';
import type { TaxCodeId } from './tax';

export interface JournalLine {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
  dims?: Record<string, string>;
}

export interface AccountMap {
  ar: string;
  vatOutput: string;
  vatInputRc: string;
  vatOutputRc: string;
  bank: string;
}

export interface JournalDocLine {
  accountCode: string;
  net: Decimal.Value;
  tax: Decimal.Value;
  taxCode: TaxCodeId;
  reverseCharge?: boolean;
  dims?: Record<string, string>;
}
export interface JournalDoc {
  lines: JournalDocLine[];
  /** AED per 1 unit of document currency; omit for AED */
  fxRate?: Decimal.Value;
}

const ZERO = new Decimal(0);
type Dims = Record<string, string> | undefined;
const dr = (accountCode: string, v: Decimal, dims?: Dims): JournalLine => ({
  accountCode,
  debit: v,
  credit: ZERO,
  ...(dims && { dims }),
});
const cr = (accountCode: string, v: Decimal, dims?: Dims): JournalLine => ({
  accountCode,
  debit: ZERO,
  credit: v,
  ...(dims && { dims }),
});

export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new DomainError('UNBALANCED_JOURNAL', 'journal needs at least 2 lines');
  let d = ZERO;
  let c = ZERO;
  for (const l of lines) {
    if (l.debit.isNeg() || l.credit.isNeg() || (l.debit.gt(0) && l.credit.gt(0)))
      throw new DomainError('INVALID_JOURNAL_LINE', `bad line ${l.accountCode}`);
    d = d.plus(l.debit);
    c = c.plus(l.credit);
  }
  if (!d.eq(c))
    throw new DomainError('UNBALANCED_JOURNAL', `debit ${d} != credit ${c}`, {
      debit: d.toString(),
      credit: c.toString(),
    });
}

/** Dr AR / Cr revenue (net) / Cr VAT output; RC: Dr VAT input RC / Cr VAT output RC. Amounts in AED. */
export function buildInvoiceJournal(doc: JournalDoc, map: AccountMap): JournalLine[] {
  const fx = (v: Decimal.Value): Decimal => (doc.fxRate === undefined ? new Decimal(v) : convert(v, doc.fxRate));
  const out: JournalLine[] = [];
  let ar = ZERO;
  let vat = ZERO;
  for (const l of doc.lines) {
    const net = fx(l.net);
    const tax = fx(l.tax);
    if (net.gt(0)) out.push(cr(l.accountCode, net, l.dims));
    ar = ar.plus(net);
    if (tax.gt(0)) {
      if (l.reverseCharge) out.push(dr(map.vatInputRc, tax), cr(map.vatOutputRc, tax));
      else vat = vat.plus(tax);
    }
  }
  if (vat.gt(0)) out.push(cr(map.vatOutput, vat));
  out.unshift(dr(map.ar, ar.plus(vat)));
  assertBalanced(out);
  return out;
}

/** Credit note = exact reverse of the equivalent invoice journal. */
export function buildCreditNoteJournal(doc: JournalDoc, map: AccountMap): JournalLine[] {
  return reverseJournal(buildInvoiceJournal(doc, map));
}

export function reverseJournal(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Dr Bank / Cr AR (AED). */
export function buildReceiptJournal(amountAed: Decimal.Value, map: AccountMap): JournalLine[] {
  const a = new Decimal(amountAed);
  if (!a.gt(0)) throw new DomainError('INVALID_AMOUNT', 'receipt must be > 0');
  const out = [dr(map.bank, a), cr(map.ar, a)];
  assertBalanced(out);
  return out;
}
