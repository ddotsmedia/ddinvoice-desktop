import { describe, expect, it } from 'vitest';
import { duplicateRow, moveCell, parsePaste, removeRow } from './grid';
import { computeTotals, isDecimalText } from './totals';
import { versionAtLeast } from './api';
import { csvCell, toCsv } from './csv';
import { visibleNav, NAV } from './nav';

describe('grid navigation', () => {
  it('Enter moves down and clamps at the last row', () => {
    expect(moveCell({ row: 0, col: 2 }, 'Enter', false, 3, 5)).toEqual({ row: 1, col: 2 });
    expect(moveCell({ row: 2, col: 2 }, 'Enter', false, 3, 5)).toEqual({ row: 2, col: 2 });
  });

  it('Tab wraps to the next row and Shift+Tab to the previous', () => {
    expect(moveCell({ row: 0, col: 4 }, 'Tab', false, 3, 5)).toEqual({ row: 1, col: 0 });
    expect(moveCell({ row: 1, col: 0 }, 'Tab', true, 3, 5)).toEqual({ row: 0, col: 4 });
  });

  it('arrows clamp at the edges', () => {
    expect(moveCell({ row: 0, col: 0 }, 'ArrowLeft', false, 3, 5)).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 1, col: 4 }, 'ArrowRight', false, 3, 5)).toEqual({ row: 1, col: 4 });
    expect(moveCell({ row: 1, col: 1 }, 'ArrowDown', false, 3, 5)).toEqual({ row: 2, col: 1 });
  });

  it('duplicate inserts a copy after the row; remove keeps at least one row', () => {
    expect(duplicateRow(['a', 'b'], 0)).toEqual(['a', 'a', 'b']);
    expect(removeRow(['a', 'b'], 0)).toEqual(['b']);
    expect(removeRow(['a'], 0)).toEqual(['a']);
  });

  it('parses spreadsheet paste (CRLF, tabs, trailing newline)', () => {
    expect(parsePaste('Widget\t2\t10.50\r\nGadget\t1\t3\r\n')).toEqual([
      ['Widget', '2', '10.50'],
      ['Gadget', '1', '3'],
    ]);
    expect(parsePaste('')).toEqual([]);
  });
});

describe('totals (display only)', () => {
  it('computes 5% VAT with half-up rounding per line', () => {
    const t = computeTotals([{ description: 'x', qty: '3', unitPrice: '10', discountPct: '0', taxCode: 'SR' }]);
    expect(t.subtotal).toBe('30.00');
    expect(t.taxTotal).toBe('1.50');
    expect(t.total).toBe('31.50');
    expect(t.lineAmounts).toEqual(['30.00']);
  });

  it('zero-rated and exempt lines carry no tax', () => {
    const t = computeTotals([
      { description: 'a', qty: '1', unitPrice: '100', discountPct: '0', taxCode: 'ZR' },
      { description: 'b', qty: '1', unitPrice: '100', discountPct: '0', taxCode: 'EX' },
    ]);
    expect(t.taxTotal).toBe('0.00');
    expect(t.total).toBe('200.00');
  });

  it('discounts reduce the taxable base', () => {
    const t = computeTotals([{ description: 'a', qty: '2', unitPrice: '50', discountPct: '10', taxCode: 'SR' }]);
    expect(t.discountTotal).toBe('10.00');
    expect(t.taxTotal).toBe('4.50');
    expect(t.total).toBe('94.50');
  });

  it('partial input does not throw and is ignored until valid', () => {
    const t = computeTotals([{ description: 'a', qty: '1.', unitPrice: '-5', discountPct: '0', taxCode: 'SR' }]);
    expect(t.total).toBe('0.00');
    expect(isDecimalText('1.')).toBe(true);
    expect(isDecimalText('-1')).toBe(false);
    expect(isDecimalText('1e3')).toBe(false);
  });

  it('keeps 6dp quantities exact', () => {
    const t = computeTotals([{ description: 'a', qty: '0.333333', unitPrice: '3', discountPct: '0', taxCode: 'ZR' }]);
    expect(t.subtotal).toBe('1.00');
  });
});

describe('permission-driven navigation', () => {
  it('hides items the user has no permission for and drops empty sections', () => {
    const sections = visibleNav(new Set(['invoice.read']), NAV);
    const items = sections.flatMap((s) => s.items.map((i) => i.key));
    expect(items).toContain('invoices');
    expect(items).toContain('overview');
    expect(items).not.toContain('journals');
    expect(items).not.toContain('chartOfAccounts');
    expect(sections.map((s) => s.key)).not.toContain('accounting');
  });

  it('an empty permission set shows only Overview', () => {
    const items = visibleNav(new Set(), NAV).flatMap((s) => s.items.map((i) => i.key));
    expect(items).toEqual(['overview']);
  });
});

describe('versions and CSV', () => {
  it('compares dotted versions numerically', () => {
    expect(versionAtLeast('0.5.0', '0.5.0')).toBe(true);
    expect(versionAtLeast('0.10.0', '0.9.9')).toBe(true);
    expect(versionAtLeast('0.4.9', '0.5.0')).toBe(false);
  });

  it('quotes CSV cells and neutralises formula prefixes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsv(['h'], [['1']])).toBe('h\r\n1\r\n');
  });
});
