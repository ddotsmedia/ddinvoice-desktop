import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Decimal,
  DomainError,
  Money,
  UAE_TAX_CODES,
  allocate,
  assertBalanced,
  buildCreditNoteJournal,
  buildInvoiceJournal,
  buildReceiptJournal,
  calcDocument,
  calcLine,
  convert,
  deriveSettlement,
  format,
  isPeriodOpen,
  issue,
  markSent,
  parse,
  reverseJournal,
  roundDoc,
  roundLine,
  toBase,
  transitionEInvoice,
  voidDocument,
  type AccountMap,
  type JournalDoc,
  type TaxCodeId,
} from '../src';

const dir = join(__dirname, 'fixtures');
const map: AccountMap = { ar: '1200', vatOutput: '2200', vatInputRc: '1300', vatOutputRc: '2210', bank: '1000' };
interface Fx {
  currency: string;
  fxRate?: string;
  docDiscount?: { pct?: string; amt?: string };
  lines: {
    qty: string;
    unitPrice: string;
    discountPct?: string;
    discountAmt?: string;
    taxCode: TaxCodeId;
    priceIncludesTax?: boolean;
  }[];
  expected: Record<string, string>;
}
const load = (n: string): Fx => JSON.parse(readFileSync(join(dir, n), 'utf8')) as Fx;
const run = (f: Fx) => calcDocument(f.lines.map((l) => ({ ...l, taxCode: UAE_TAX_CODES[l.taxCode] })), f.docDiscount);
const toJournalDoc = (f: Fx, r: ReturnType<typeof run>): JournalDoc => ({
  ...(f.fxRate && { fxRate: f.fxRate }),
  lines: r.lines.map((l) => ({
    accountCode: '4000',
    net: l.net,
    tax: l.tax,
    taxCode: l.taxCode,
    reverseCharge: l.reverseCharge,
  })),
});

describe('fixtures', () => {
  for (const name of readdirSync(dir)) {
    it(`${name}: totals + balanced journals`, () => {
      const f = load(name);
      const r = run(f);
      expect(r.subtotal.toFixed(2)).toBe(f.expected.subtotal);
      expect(r.discountTotal.toFixed(2)).toBe(f.expected.discountTotal);
      expect(r.taxTotal.toFixed(2)).toBe(f.expected.taxTotal);
      expect(r.rcTaxTotal.toFixed(2)).toBe(f.expected.rcTaxTotal);
      expect(r.total.toFixed(2)).toBe(f.expected.total);
      const j = buildInvoiceJournal(toJournalDoc(f, r), map);
      assertBalanced(j);
      if (f.expected.arAed) expect(j[0]!.debit.toFixed(2)).toBe(f.expected.arAed);
      assertBalanced(buildCreditNoteJournal(toJournalDoc(f, r), map));
    });
  }
  it('taxable/tax by code', () => {
    const r = run(load('mixed-codes.json'));
    expect(r.taxableByCode.SR!.toFixed(2)).toBe('100.00');
    expect(r.taxByCode.SR!.toFixed(2)).toBe('5.00');
    expect(r.taxableByCode.EX!.toFixed(2)).toBe('50.00');
  });
  it('RC line: tax self-assessed, not charged', () => {
    const l = calcLine({ qty: 1, unitPrice: 1000, taxCode: UAE_TAX_CODES.RC });
    expect(l.tax.toFixed(2)).toBe('50.00');
    expect(l.gross.toFixed(2)).toBe('1000.00');
    const f = load('reverse-charge.json');
    const j = buildInvoiceJournal(toJournalDoc(f, run(f)), map);
    expect(j.find((x) => x.accountCode === '1300')!.debit.toFixed(2)).toBe('50.00');
    expect(j.find((x) => x.accountCode === '2210')!.credit.toFixed(2)).toBe('50.00');
  });
  it('USD journal in AED', () => {
    const f = load('usd-invoice.json');
    const j = buildInvoiceJournal(toJournalDoc(f, run(f)), map);
    expect(j.find((x) => x.accountCode === '4000')!.credit.toFixed(2)).toBe('3672.50');
    expect(j.find((x) => x.accountCode === '2200')!.credit.toFixed(2)).toBe('183.63');
  });
});

describe('rounding & line validation', () => {
  it('.005 edges half-up', () => {
    expect(roundLine('0.005').toFixed(2)).toBe('0.01');
    expect(roundLine('-0.005').toFixed(2)).toBe('-0.01');
    expect(roundLine('1.004999').toFixed(2)).toBe('1.00');
    expect(roundDoc('2.675', 2).toFixed(2)).toBe('2.68');
  });
  it('rejects bad input', () => {
    const SR = UAE_TAX_CODES.SR;
    expect(() => calcLine({ qty: -1, unitPrice: 1, taxCode: SR })).toThrow(DomainError);
    expect(() => calcLine({ qty: 1, unitPrice: 1, discountPct: 101, taxCode: SR })).toThrow(DomainError);
    expect(() => calcLine({ qty: 1, unitPrice: 1, discountAmt: 2, taxCode: SR })).toThrow(DomainError);
    const ok = [{ qty: 1, unitPrice: 10, taxCode: SR }];
    expect(() => calcDocument(ok, { pct: 101 })).toThrow(DomainError);
    expect(() => calcDocument(ok, { amt: 11 })).toThrow(DomainError);
  });
});

describe('money & fx', () => {
  it('ops', () => {
    const a = Money.fromString('10.005', 'AED');
    expect(a.toString()).toBe('10.01');
    expect(a.add(Money.of(1, 'AED')).round().toString()).toBe('11.01');
    expect(a.sub(Money.of(10, 'AED')).isZero()).toBe(false);
    expect(Money.of(2, 'AED').mul('1.5').eq(Money.of(3, 'AED'))).toBe(true);
    expect(Money.of(1, 'AED').eq(Money.of(1, 'USD'))).toBe(false);
    expect(() => a.add(Money.of(1, 'USD'))).toThrow(DomainError);
    expect(() => a.sub(Money.of(1, 'USD'))).toThrow(DomainError);
    expect(() => Money.fromString('abc', 'AED')).toThrow(DomainError);
  });
  it('convert', () => {
    expect(convert('1050', '3.6725').toFixed(2)).toBe('3856.13');
    expect(() => convert(1, 0)).toThrow(DomainError);
    expect(toBase(Money.of(100, 'USD'), '3.6725').toString()).toBe('367.25');
    expect(toBase(Money.of(100, 'AED'), '9').toString()).toBe('100.00');
  });
});

describe('numbering', () => {
  const d = new Date(Date.UTC(2026, 10, 5));
  it('format/parse', () => {
    expect(format('INV-{YYYY}-{SEQ:6}', 42, d)).toBe('INV-2026-000042');
    expect(format('{YY}{MM}{DD}/{SEQ}', 7, d)).toBe('261105/7');
    expect(parse('INV-{YYYY}-{SEQ:6}', 'INV-2026-000042')).toEqual({ seq: 42, year: 2026 });
    expect(parse('{YY}{MM}{DD}/{SEQ}', '261105/7')).toEqual({ seq: 7, year: 2026, month: 11, day: 5 });
    expect(parse('INV-{SEQ:6}', 'INV-12')).toBeNull();
    expect(parse('A.{SEQ}', 'AxB')).toBeNull();
    expect(() => format('{SEQ}', -1, d)).toThrow(DomainError);
  });
});

describe('state', () => {
  it('transitions', () => {
    expect(issue('DRAFT')).toBe('ISSUED');
    expect(() => issue('ISSUED')).toThrow(DomainError);
    expect(() => voidDocument('ISSUED')).toThrow(/credit note/);
    expect(() => voidDocument('DRAFT')).toThrow(DomainError);
    expect(markSent()).toBe('SENT');
    expect(transitionEInvoice('PENDING', 'SUBMITTED')).toBe('SUBMITTED');
    expect(transitionEInvoice('REJECTED', 'PENDING')).toBe('PENDING');
    expect(() => transitionEInvoice('ACCEPTED', 'PENDING')).toThrow(DomainError);
    expect(() => transitionEInvoice('NOT_REQUIRED', 'PENDING')).toThrow(DomainError);
  });
  it('settlement derived', () => {
    expect(deriveSettlement('100', '0')).toBe('UNPAID');
    expect(deriveSettlement('100', '40')).toBe('PARTIAL');
    expect(deriveSettlement('100', '100')).toBe('PAID');
    expect(deriveSettlement('100', '100.01')).toBe('OVERPAID');
  });
});

describe('journal', () => {
  const z = new Decimal(0);
  const n = (v: number) => new Decimal(v);
  it('unbalanced / invalid rejected', () => {
    expect(() => assertBalanced([{ accountCode: 'a', debit: n(1), credit: z }])).toThrow(DomainError);
    expect(() =>
      assertBalanced([
        { accountCode: 'a', debit: n(1), credit: z },
        { accountCode: 'b', debit: z, credit: n(2) },
      ]),
    ).toThrow(/debit/);
    expect(() =>
      assertBalanced([
        { accountCode: 'a', debit: n(1), credit: n(1) },
        { accountCode: 'b', debit: z, credit: z },
      ]),
    ).toThrow(DomainError);
    expect(() =>
      assertBalanced([
        { accountCode: 'a', debit: n(-1), credit: z },
        { accountCode: 'b', debit: z, credit: n(-1) },
      ]),
    ).toThrow(DomainError);
    expect(() => buildReceiptJournal(0, map)).toThrow(DomainError);
  });
  it('dims preserved; credit note reverses invoice', () => {
    const doc: JournalDoc = {
      lines: [{ accountCode: '4000', net: 100, tax: 5, taxCode: 'SR', dims: { branch: 'DXB' } }],
    };
    const inv = buildInvoiceJournal(doc, map);
    expect(inv.find((l) => l.accountCode === '4000')!.dims).toEqual({ branch: 'DXB' });
    expect(buildCreditNoteJournal(doc, map)).toEqual(reverseJournal(inv));
  });
  it('partial credit note', () => {
    const r = calcDocument([{ qty: 1, unitPrice: 100, taxCode: UAE_TAX_CODES.SR }]);
    const cn = buildCreditNoteJournal(
      { lines: r.lines.map((l) => ({ accountCode: '4000', net: l.net, tax: l.tax, taxCode: l.taxCode })) },
      map,
    );
    expect(cn[0]!.credit.toFixed(2)).toBe('105.00');
    expect(deriveSettlement(new Decimal('294.31').minus(105), 0)).toBe('UNPAID');
  });
});

describe('receipts & allocation', () => {
  const invs = [
    { id: 'B', date: '2026-02-01', open: '200' },
    { id: 'A', date: '2026-01-01', open: '94.31' },
  ];
  it('partial then full receipt', () => {
    const p1 = allocate('100', [{ id: 'I', date: '2026-01-01', open: '294.31' }]);
    expect(p1.customerCredit.toFixed(2)).toBe('0.00');
    expect(deriveSettlement('294.31', p1.allocated)).toBe('PARTIAL');
    const p2 = allocate('194.31', [{ id: 'I', date: '2026-01-01', open: new Decimal('294.31').minus(p1.allocated) }]);
    expect(deriveSettlement('294.31', p1.allocated.plus(p2.allocated))).toBe('PAID');
    assertBalanced(buildReceiptJournal(p1.allocated, map));
  });
  it('oldest first', () => {
    const r = allocate('150', invs);
    expect(r.allocations.map((a) => [a.invoiceId, a.amount.toFixed(2)])).toEqual([
      ['A', '94.31'],
      ['B', '55.69'],
    ]);
  });
  it('stops when payment exhausted; skips zero balances', () => {
    const r = allocate('94.31', [...invs, { id: 'C', date: '2026-03-01', open: '0' }]);
    expect(r.allocations).toHaveLength(1);
    expect(allocate('10', [{ id: 'Z', date: '2026-01-01', open: '0' }]).allocations).toHaveLength(0);
  });
  it('overpayment -> customer credit', () => {
    const r = allocate('500', invs);
    expect(r.allocated.toFixed(2)).toBe('294.31');
    expect(r.customerCredit.toFixed(2)).toBe('205.69');
  });
  it('manual allocation + guards', () => {
    const r = allocate('100', invs, [{ invoiceId: 'B', amount: '60' }]);
    expect(r.customerCredit.toFixed(2)).toBe('40.00');
    expect(() => allocate('100', invs, [{ invoiceId: 'A', amount: '95' }])).toThrow(/open balance/);
    expect(() => allocate('50', invs, [{ invoiceId: 'B', amount: '60' }])).toThrow(/unallocated/);
    expect(() => allocate('50', invs, [{ invoiceId: 'X', amount: '1' }])).toThrow(DomainError);
    expect(() => allocate('0', invs)).toThrow(DomainError);
  });
});

describe('period', () => {
  const ps = [
    { start: '2026-01-01', end: '2026-01-31', status: 'CLOSED' as const },
    { start: '2026-02-01', end: '2026-02-28', status: 'OPEN' as const },
  ];
  it('open/closed/none', () => {
    expect(isPeriodOpen('2026-02-15', ps)).toBe(true);
    expect(isPeriodOpen('2026-02-15T10:00:00Z', ps)).toBe(true);
    expect(isPeriodOpen('2026-01-15', ps)).toBe(false);
    expect(isPeriodOpen('2027-01-01', ps)).toBe(false);
  });
});
