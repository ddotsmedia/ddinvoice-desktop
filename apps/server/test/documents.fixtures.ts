import { Decimal, roundAed } from '@ddinvoice/domain';
import type { SnapshotLine, SnapshotParty, SnapshotPayload } from '@ddinvoice/documents';

/** Fictional parties only. TRNs are 15-digit test values. */
export const SELLER: SnapshotParty = {
  nameEn: 'Al Noor Trading LLC',
  nameAr: 'شركة النور للتجارة ذ.م.م',
  trn: '100000000000003',
  addressEn: 'Office 12, Business Bay, Dubai, UAE',
  addressAr: 'مكتب ١٢، الخليج التجاري، دبي، الإمارات العربية المتحدة',
};

export const BUYER: SnapshotParty = {
  nameEn: 'Gulf Retail Co.',
  nameAr: 'شركة الخليج للتجزئة',
  trn: '100000000000017',
  addressEn: 'Building 7, Al Quoz Industrial Area 3, Dubai, UAE',
  addressAr: 'المبنى ٧، منطقة القوز الصناعية ٣، الشارع الصناعي الرئيسي بجوار مركز الصيانة، دبي، الإمارات العربية المتحدة',
};

export interface LineSpec {
  description: string;
  qty: string;
  unitPrice: string;
  taxCode: 'SR' | 'ZR' | 'EX' | 'RC';
}

const RATE: Record<LineSpec['taxCode'], string> = { SR: '5', ZR: '0', EX: '0', RC: '0' };

/** Builds snapshot lines with the same arithmetic the server uses (4 dp stored amounts). */
export function buildLines(specs: LineSpec[]): SnapshotLine[] {
  return specs.map((s, i) => {
    const net = new Decimal(s.qty).times(s.unitPrice);
    const tax = net.times(RATE[s.taxCode]).div(100);
    return {
      lineNo: i + 1,
      description: s.description,
      qty: s.qty,
      unitPrice: s.unitPrice,
      taxCode: s.taxCode,
      taxRate: RATE[s.taxCode],
      net: net.toFixed(4),
      tax: tax.toFixed(4),
      gross: net.plus(tax).toFixed(4),
    };
  });
}

export function totalsOf(lines: SnapshotLine[], fxRate: string) {
  const sum = (f: (l: SnapshotLine) => string) => lines.reduce((a, l) => a.plus(f(l)), new Decimal(0));
  const subtotal = sum((l) => l.net);
  const taxTotal = sum((l) => l.tax);
  const total = subtotal.plus(taxTotal);
  return {
    subtotal: subtotal.toFixed(4),
    discountTotal: '0.0000',
    taxTotal: taxTotal.toFixed(4),
    total: total.toFixed(4),
    totalAed: roundAed(total.times(fxRate)).toFixed(4),
  };
}

function base(number: string, currency: string, fxRate: string, lines: SnapshotLine[]): SnapshotPayload {
  return {
    docType: 'INVOICE',
    number,
    issueDate: '2026-11-20',
    supplyDate: '2026-11-18',
    dueDate: '2026-12-20',
    currency,
    fxRate,
    seller: SELLER,
    buyer: BUYER,
    lines,
    totals: totalsOf(lines, fxRate),
  };
}

const SPEC_MIXED: LineSpec[] = [
  { description: 'Office chair, ergonomic', qty: '4', unitPrice: '650.00', taxCode: 'SR' },
  { description: 'Export consignment, freight', qty: '1', unitPrice: '1200.00', taxCode: 'ZR' },
  { description: 'Residential rent (exempt)', qty: '1', unitPrice: '3500.00', taxCode: 'EX' },
  { description: 'Imported services (reverse charge)', qty: '2.5', unitPrice: '410.00', taxCode: 'RC' },
];

export function longSpecs(count: number): LineSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    description: `Item ${String(i + 1).padStart(3, '0')} — catalogue part ${1000 + i}`,
    qty: String((i % 7) + 1),
    unitPrice: `${(i % 50) + 10}.25`,
    taxCode: 'SR' as const,
  }));
}

export interface Fixture {
  name: string;
  payload: SnapshotPayload;
}

/** The fixture set from the spec: simple, mixed tax, USD, 200 lines, long Arabic addresses. */
export function fixtures(): Fixture[] {
  const simple = buildLines([{ description: 'Consulting, March', qty: '1', unitPrice: '1000.00', taxCode: 'SR' }]);
  const mixed = buildLines(SPEC_MIXED);
  const usd = buildLines([{ description: 'Software licence (USD)', qty: '3', unitPrice: '199.99', taxCode: 'ZR' }]);
  const long = buildLines(longSpecs(200));
  const arabicAddr = buildLines([{ description: 'Installation service', qty: '2', unitPrice: '75.50', taxCode: 'SR' }]);
  return [
    { name: 'simple', payload: { ...base('INV-2026-0001', 'AED', '1', simple) } },
    { name: 'mixed-tax', payload: { ...base('INV-2026-0002', 'AED', '1', mixed) } },
    { name: 'usd', payload: { ...base('INV-2026-0003', 'USD', '3.6725', usd) } },
    { name: 'long-200', payload: { ...base('INV-2026-0004', 'AED', '1', long) } },
    {
      name: 'arabic-addresses',
      payload: { ...base('INV-2026-0005', 'AED', '1', arabicAddr), seller: SELLER, buyer: { ...BUYER, trn: null } },
    },
  ];
}

/** Credit note fixture referencing the simple invoice. */
export function creditNoteFixture(): Fixture {
  const lines = buildLines([{ description: 'Consulting, March (credit)', qty: '1', unitPrice: '400.00', taxCode: 'SR' }]);
  return {
    name: 'credit-note',
    payload: {
      ...base('CN-2026-0001', 'AED', '1', lines),
      docType: 'CREDIT_NOTE',
      supplyDate: null,
      dueDate: null,
      invoiceNumber: 'INV-2026-0001',
      reason: 'Partial refund for March consulting',
    },
  };
}
