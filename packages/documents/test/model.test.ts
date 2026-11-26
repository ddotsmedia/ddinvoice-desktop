import { describe, expect, it } from 'vitest';
import { buildViewModel, groupDigits, money, renderDocument, type SnapshotPayload } from '../src';

const party = {
  nameEn: 'Al Noor Trading LLC',
  nameAr: 'شركة النور',
  trn: '100000000000003',
  addressEn: 'Business Bay, Dubai',
  addressAr: 'الخليج التجاري، دبي',
};

const payload = (over: Partial<SnapshotPayload> = {}): SnapshotPayload => ({
  docType: 'INVOICE',
  number: 'INV-2026-0042',
  issueDate: '2026-11-20',
  supplyDate: '2026-11-20',
  dueDate: '2026-12-20',
  currency: 'AED',
  fxRate: '1',
  seller: party,
  buyer: { ...party, trn: null, nameEn: 'Gulf Retail', nameAr: 'الخليج' },
  lines: [
    { lineNo: 1, description: 'Chair', qty: '2', unitPrice: '1000.00', taxCode: 'SR', taxRate: '5', net: '2000.0000', tax: '100.0000', gross: '2100.0000' },
    { lineNo: 2, description: 'Export', qty: '1', unitPrice: '500.00', taxCode: 'ZR', taxRate: '0', net: '500.0000', tax: '0.0000', gross: '500.0000' },
  ],
  totals: { subtotal: '2500.0000', discountTotal: '0.0000', taxTotal: '100.0000', total: '2600.0000', totalAed: '2600.0000' },
  ...over,
});

const opts = { templateVersion: 'v1', fontBase: 'file:///fonts/' };

describe('money and digits', () => {
  it('groups thousands and rounds half-up to 2 dp without JS numbers', () => {
    expect(money('1234567.005')).toBe('1,234,567.01');
    expect(money('-1200')).toBe('-1,200.00');
    expect(groupDigits('999')).toBe('999');
  });
});

describe('buildViewModel', () => {
  it('omits the supply date when it equals the issue date and shows it otherwise', () => {
    expect(buildViewModel(payload(), { lang: 'en', ...opts }).showSupplyDate).toBe(false);
    expect(buildViewModel(payload({ supplyDate: '2026-11-18' }), { lang: 'en', ...opts }).showSupplyDate).toBe(true);
  });

  it('bilingual shows English and Arabic party names; Arabic is rtl', () => {
    const bi = buildViewModel(payload(), { lang: 'bi', ...opts });
    expect(bi.seller.names.map((n) => n.dir)).toEqual(['ltr', 'rtl']);
    expect(buildViewModel(payload(), { lang: 'ar', ...opts }).dir).toBe('rtl');
    expect(buildViewModel(payload(), { lang: 'en', ...opts }).dir).toBe('ltr');
  });

  it('VAT total is shown in AED and the tax summary groups by code', () => {
    const v = buildViewModel(payload({ currency: 'USD', fxRate: '3.6725' }), { lang: 'en', ...opts });
    expect(v.totals.vat).toBe('367.25');
    expect(v.showFx).toBe(true);
    expect(v.taxSummary.map((t) => [t.code, t.taxable, t.tax])).toEqual([
      ['SR', '2,000.00', '100.00'],
      ['ZR', '500.00', '0.00'],
    ]);
  });

  it('draft watermark is set only for drafts; credit notes carry the original reference', () => {
    expect(buildViewModel(payload(), { lang: 'en', ...opts, draft: true }).watermark).toBe('DRAFT');
    expect(buildViewModel(payload(), { lang: 'en', ...opts }).watermark).toBeNull();
    const cn = buildViewModel(payload({ docType: 'CREDIT_NOTE', invoiceNumber: 'INV-1', reason: 'Refund' }), { lang: 'en', ...opts });
    expect(cn.original?.number).toBe('INV-1');
    expect(cn.reason).toBe('Refund');
  });
});

describe('renderDocument', () => {
  it.each(['en', 'ar', 'bi'] as const)('renders invoice and credit note in %s without missing keys (strict mode)', (lang) => {
    const inv = renderDocument(payload(), { lang }).html;
    expect(inv).toContain('INV-2026-0042');
    expect(inv).toContain('100000000000003');
    const cn = renderDocument(payload({ docType: 'CREDIT_NOTE', invoiceNumber: 'INV-1', reason: 'Refund' }), { lang }).html;
    expect(cn).toContain('Refund');
  });

  it('sets the document direction from the language', () => {
    expect(renderDocument(payload(), { lang: 'ar' }).html).toContain('dir="rtl"');
    expect(renderDocument(payload(), { lang: 'en' }).html).toContain('dir="ltr"');
  });
});
