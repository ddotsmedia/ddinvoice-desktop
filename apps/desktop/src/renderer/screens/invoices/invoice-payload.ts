import type { TaxCodeId } from '@ddinvoice/domain';
import type { EditableLine } from '../../lib/totals';
import type { TaxCodeRow } from '../../lib/types';

export const EMPTY_LINE = (): EditableLine & { key: string } => ({
  key: crypto.randomUUID(),
  description: '',
  qty: '1',
  unitPrice: '0',
  discountPct: '0',
  taxCode: 'SR',
});

export interface HeaderValues {
  customerId: string;
  supplyDate: string;
  currency: string;
  fxRate: string;
  terms: string;
  notes: string;
}

/** A row with nothing typed in it is dropped on save; the grid keeps it visible until then. */
export function isBlankLine(l: EditableLine): boolean {
  return l.description.trim() === '' && (l.qty === '' || l.qty === '1') && (l.unitPrice === '' || l.unitPrice === '0') && (l.discountPct === '' || l.discountPct === '0');
}

/**
 * Body for POST /invoices and PATCH /invoices/:id. Decimals go out as strings, tax codes are sent as the server's tax code IDs.
 * Throws when a line references a tax code the server does not know (e.g. the reference data has not loaded).
 */
export function buildInvoiceBody(header: HeaderValues, lines: EditableLine[], taxCodes: TaxCodeRow[]) {
  const idByCode = new Map(taxCodes.map((t) => [t.code, t.id]));
  return {
    customerId: header.customerId,
    currency: header.currency || 'AED',
    ...(header.fxRate ? { fxRate: header.fxRate } : {}),
    ...(header.supplyDate ? { supplyDate: header.supplyDate } : {}),
    terms: header.terms,
    notes: header.notes,
    lines: lines
      .filter((l) => !isBlankLine(l))
      .map((l) => {
        const taxCodeId = idByCode.get(l.taxCode);
        if (!taxCodeId) throw new Error(`Unknown tax code ${l.taxCode}`);
        return {
          description: l.description,
          qty: l.qty === '' ? '0' : l.qty,
          unitPrice: l.unitPrice === '' ? '0' : l.unitPrice,
          discountPct: l.discountPct === '' ? '0' : l.discountPct,
          taxCodeId,
        };
      }),
  };
}

const GRID_FIELDS = ['description', 'qty', 'unitPrice', 'discountPct', 'taxCode'] as const;

/**
 * Writes spreadsheet rows (Excel/Sheets clipboard) into the grid starting at (row, col). Extra rows are appended.
 * Columns follow the grid order; an unknown tax code keeps the existing value.
 */
export function pasteIntoLines<T extends EditableLine>(lines: T[], startRow: number, startCol: number, rows: string[][], make: () => T, taxCodes: ReadonlySet<string>): T[] {
  const next = [...lines];
  rows.forEach((cells, dr) => {
    const r = startRow + dr;
    while (next.length <= r) next.push(make());
    const line = { ...next[r]! };
    cells.forEach((value, dc) => {
      const field = GRID_FIELDS[startCol + dc];
      if (!field) return;
      if (field === 'taxCode') {
        const code = value.toUpperCase();
        if (taxCodes.has(code)) line.taxCode = code as TaxCodeId;
      } else {
        (line as Record<string, unknown>)[field] = value;
      }
    });
    next[r] = line;
  });
  return next;
}

/** Maps ApiError.fields (e.g. "lines.0.qty", "customerId") onto header keys and grid cells. */
export function splitFieldErrors(fields: Record<string, string>): { header: Record<string, string>; cells: Record<string, string> } {
  const header: Record<string, string> = {};
  const cells: Record<string, string> = {};
  for (const [path, message] of Object.entries(fields)) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(path);
    if (m) cells[`${m[1]}:${m[2]}`] = message;
    else header[path] = message;
  }
  return { header, cells };
}
