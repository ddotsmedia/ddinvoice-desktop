import { describe, expect, it } from 'vitest';
import type { InvoiceDetail } from '../../lib/types';
import { conflictFields } from './conflict';
import type { HeaderValues } from './invoice-payload';

const header: HeaderValues = { customerId: 'c1', supplyDate: '2026-11-26', currency: 'AED', fxRate: '', terms: '', notes: 'mine' };
const line = { description: 'A', qty: '2', unitPrice: '100', discountPct: '0', taxCode: 'SR' as const };
const names = (id: string) => (id === 'c1' ? 'Acme' : id === 'c2' ? 'Beta' : id);

function theirs(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: 'i1',
    customerId: 'c1',
    supplyDate: '2026-11-26',
    currency: 'AED',
    fxRate: '1',
    terms: '',
    notes: 'theirs',
    total: '210.00',
    lines: [{ id: 'l1' }],
    ...over,
  } as unknown as InvoiceDetail;
}

describe('conflictFields', () => {
  it('lists only the fields that differ, with both values', () => {
    const out = conflictFields({ header, lines: [line] }, theirs({ customerId: 'c2' }), names);
    expect(out).toEqual([
      { field: 'customer', mine: 'Acme', theirs: 'Beta' },
      { field: 'notes', mine: 'mine', theirs: 'theirs' },
    ]);
  });

  it('reports no header differences for an identical copy', () => {
    const same = theirs({ notes: 'mine', total: '210.00' });
    expect(conflictFields({ header, lines: [line] }, same, names)).toEqual([]);
  });

  it('treats an empty FX rate as 1', () => {
    expect(conflictFields({ header, lines: [line] }, theirs({ notes: 'mine' }), names)).toEqual([]);
  });
});
