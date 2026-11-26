import type { EditableLine } from '../../lib/totals';
import { computeTotals } from '../../lib/totals';
import type { InvoiceDetail } from '../../lib/types';
import type { HeaderValues } from './invoice-payload';

export type ConflictField = 'customer' | 'supplyDate' | 'currency' | 'fxRate' | 'terms' | 'notes' | 'lines';

export interface FieldConflict {
  field: ConflictField;
  mine: string;
  theirs: string;
}

/**
 * Per-field comparison of the local draft against the server copy returned with a 409 VERSION_CONFLICT.
 * Only fields that differ are returned. Lines compare as a count and grand total (the grid keeps line detail locally).
 */
export function conflictFields(
  mine: { header: HeaderValues; lines: EditableLine[] },
  theirs: InvoiceDetail,
  customerName: (id: string) => string,
): FieldConflict[] {
  const out: FieldConflict[] = [];
  const add = (field: ConflictField, m: string, t: string) => {
    if (m.trim() !== t.trim()) out.push({ field, mine: m, theirs: t });
  };
  add('customer', customerName(mine.header.customerId), customerName(theirs.customerId));
  add('supplyDate', mine.header.supplyDate, theirs.supplyDate ?? '');
  add('currency', mine.header.currency, theirs.currency);
  add('fxRate', mine.header.fxRate || '1', theirs.fxRate);
  add('terms', mine.header.terms, theirs.terms);
  add('notes', mine.header.notes, theirs.notes);
  const mineLines = mine.lines.filter((l) => l.description.trim() !== '');
  add('lines', `${mineLines.length} · ${computeTotals(mine.lines).total}`, `${theirs.lines.length} · ${theirs.total}`);
  return out;
}
