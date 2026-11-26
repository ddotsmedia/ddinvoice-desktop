import { describe, expect, it } from 'vitest';
import { buildInvoiceBody, EMPTY_LINE, pasteIntoLines, splitFieldErrors } from './invoice-payload';
import type { TaxCodeRow } from '../../lib/types';

const codes: TaxCodeRow[] = [
  { id: 'tc-sr', code: 'SR', rate: '5', labelEn: 'Standard', labelAr: 'قياسي' },
  { id: 'tc-zr', code: 'ZR', rate: '0', labelEn: 'Zero', labelAr: 'صفر' },
];
const header = { customerId: 'cust-1', supplyDate: '2026-11-26', currency: 'AED', fxRate: '', terms: '', notes: '' };

describe('invoice payload', () => {
  it('sends decimals as strings and maps tax codes to server ids', () => {
    const body = buildInvoiceBody(header, [{ description: 'Desk', qty: '2', unitPrice: '150.5', discountPct: '', taxCode: 'SR' }], codes);
    expect(body.lines).toEqual([{ description: 'Desk', qty: '2', unitPrice: '150.5', discountPct: '0', taxCodeId: 'tc-sr' }]);
    expect(body).not.toHaveProperty('fxRate');
  });

  it('drops blank rows and fails loudly on an unknown tax code', () => {
    const body = buildInvoiceBody(header, [EMPTY_LINE(), { description: 'A', qty: '1', unitPrice: '1', discountPct: '0', taxCode: 'ZR' }], codes);
    expect(body.lines.map((l) => l.taxCodeId)).toEqual(['tc-zr']);
    expect(() => buildInvoiceBody(header, [{ description: 'A', qty: '1', unitPrice: '1', discountPct: '0', taxCode: 'OOS' }], codes)).toThrow();
  });

  it('pastes spreadsheet rows at the cursor and appends as needed', () => {
    const start = [{ ...EMPTY_LINE(), description: 'keep' }];
    const next = pasteIntoLines(start, 0, 0, [['Pen', '3', '2.5'], ['Pad', '1', '9', '0', 'zr']], () => ({ ...EMPTY_LINE() }), new Set(['SR', 'ZR']));
    expect(next.length).toBe(2);
    expect(next[0]).toMatchObject({ description: 'Pen', qty: '3', unitPrice: '2.5' });
    expect(next[1]).toMatchObject({ description: 'Pad', qty: '1', unitPrice: '9', discountPct: '0', taxCode: 'ZR' });
  });

  it('paste ignores unknown tax codes', () => {
    const next = pasteIntoLines([EMPTY_LINE()], 0, 4, [['XX']], () => EMPTY_LINE(), new Set(['SR']));
    expect(next[0]!.taxCode).toBe('SR');
  });

  it('splits server field errors into header and grid cells', () => {
    const r = splitFieldErrors({ customerId: 'Required', 'lines.1.qty': 'Must be positive' });
    expect(r.header).toEqual({ customerId: 'Required' });
    expect(r.cells).toEqual({ '1:qty': 'Must be positive' });
  });
});
