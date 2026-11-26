import { useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, X } from 'lucide-react';
import { Button, Input } from '@ddinvoice/ui';
import { duplicateRow, moveCell, parsePaste, removeRow, type GridKey } from '../../lib/grid';
import { isDecimalText, type EditableLine } from '../../lib/totals';
import { EMPTY_LINE, pasteIntoLines } from './invoice-payload';

export type GridLine = EditableLine & { key: string };

/** A duplicated row gets its own React key so the grid does not reuse DOM state. */
const freshKey = (l: GridLine): GridLine => ({ ...l, key: crypto.randomUUID() });

export const GRID_COLUMNS = ['description', 'qty', 'unitPrice', 'discountPct', 'taxCode'] as const;
type Field = (typeof GRID_COLUMNS)[number];
const NAV_KEYS = new Set(['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

interface Props {
  lines: GridLine[];
  amounts: string[];
  taxCodes: string[];
  readOnly: boolean;
  /** Keyed "row:field" from ApiError.fields. */
  cellErrors: Record<string, string>;
  onChange: (lines: GridLine[]) => void;
}

/**
 * Line grid with keyboard navigation: Enter moves down (and adds a line on the last row), Tab/Shift+Tab move across and wrap,
 * arrows move one cell (left/right only at the text edge), Ctrl+D duplicates a row, Ctrl+Delete removes it, and multi-row
 * paste from a spreadsheet fills the grid.
 */
export function LineGrid({ lines, amounts, taxCodes, readOnly, cellErrors, onChange }: Props) {
  const { t } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const codeSet = new Set(taxCodes);

  const focusCell = (row: number, col: number) => {
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
  };

  const update = (row: number, field: Field, value: string) => {
    if (field !== 'description' && field !== 'taxCode' && !isDecimalText(value)) return;
    onChange(lines.map((l, i) => (i === row ? { ...l, [field]: value } : l)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, row: number, col: number) => {
    if (readOnly) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onChange(duplicateRow(lines, row, freshKey));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') {
      e.preventDefault();
      onChange(removeRow(lines, row));
      return;
    }
    if (!NAV_KEYS.has(e.key)) return;
    const key = e.key as GridKey;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      // Only leave the cell when the caret is at the text edge, so in-cell editing keeps working.
      const input = e.target as HTMLInputElement;
      if (input.tagName === 'INPUT' && input.selectionStart !== null) {
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
        if (key === 'ArrowLeft' && !atStart) return;
        if (key === 'ArrowRight' && !atEnd) return;
      }
    }
    if (key === 'Enter' && row === lines.length - 1) {
      e.preventDefault();
      const added = [...lines, { ...EMPTY_LINE(), taxCode: lines[row]?.taxCode ?? 'SR' }];
      onChange(added);
      requestAnimationFrame(() => focusCell(row + 1, col));
      return;
    }
    const next = moveCell({ row, col }, key, e.shiftKey, lines.length, GRID_COLUMNS.length);
    if (!next) return;
    const lastCell = row === lines.length - 1 && col === GRID_COLUMNS.length - 1;
    const firstCell = row === 0 && col === 0;
    if (key === 'Tab' && ((e.shiftKey && firstCell) || (!e.shiftKey && lastCell))) return; // let focus leave the grid
    e.preventDefault();
    focusCell(next.row, next.col);
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>, row: number, col: number) => {
    if (readOnly) return;
    const rows = parsePaste(e.clipboardData.getData('text'));
    if (rows.length === 1 && rows[0]!.length === 1) return; // single value: normal paste into the input
    e.preventDefault();
    onChange(pasteIntoLines(lines, row, col, rows, () => ({ ...EMPTY_LINE(), taxCode: 'SR' }), codeSet));
  };

  const headers: Record<Field, string> = {
    description: t('invoices.editor.description'),
    qty: t('invoices.editor.qty'),
    unitPrice: t('invoices.editor.unitPrice'),
    discountPct: t('invoices.editor.discount'),
    taxCode: t('invoices.editor.taxCode'),
  };

  return (
    <div ref={gridRef} className="overflow-x-auto rounded-md border border-surface-line bg-surface">
      <table className="w-full border-collapse">
        <thead className="bg-surface-muted text-navy-muted">
          <tr>
            <th className="w-8 px-2 py-1 text-start font-medium">#</th>
            {GRID_COLUMNS.map((c) => (
              <th key={c} className="px-2 py-1 text-start font-medium">
                {headers[c]}
              </th>
            ))}
            <th className="px-2 py-1 text-end font-medium">{t('invoices.editor.amount')}</th>
            <th className="w-16 px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, r) => (
            <tr key={line.key} className="border-t border-surface-line">
              <td className="px-2 py-1 text-navy-muted tabular-nums">{r + 1}</td>
              <Cell error={cellErrors[`${r}:description`]}>
                <Input data-cell={`${r}:0`} aria-label={headers.description} aria-invalid={!!cellErrors[`${r}:description`]} disabled={readOnly} value={line.description} onChange={(e) => update(r, 'description', e.target.value)} onKeyDown={(e) => onKeyDown(e, r, 0)} onPaste={(e) => onPaste(e, r, 0)} />
              </Cell>
              <Cell error={cellErrors[`${r}:qty`]}>
                <Input data-cell={`${r}:1`} dir="ltr" inputMode="decimal" className="text-end tabular-nums" aria-label={headers.qty} aria-invalid={!!cellErrors[`${r}:qty`]} disabled={readOnly} value={line.qty} onChange={(e) => update(r, 'qty', e.target.value)} onKeyDown={(e) => onKeyDown(e, r, 1)} onPaste={(e) => onPaste(e, r, 1)} />
              </Cell>
              <Cell error={cellErrors[`${r}:unitPrice`]}>
                <Input data-cell={`${r}:2`} dir="ltr" inputMode="decimal" className="text-end tabular-nums" aria-label={headers.unitPrice} aria-invalid={!!cellErrors[`${r}:unitPrice`]} disabled={readOnly} value={line.unitPrice} onChange={(e) => update(r, 'unitPrice', e.target.value)} onKeyDown={(e) => onKeyDown(e, r, 2)} onPaste={(e) => onPaste(e, r, 2)} />
              </Cell>
              <Cell error={cellErrors[`${r}:discountPct`]}>
                <Input data-cell={`${r}:3`} dir="ltr" inputMode="decimal" className="text-end tabular-nums" aria-label={headers.discountPct} aria-invalid={!!cellErrors[`${r}:discountPct`]} disabled={readOnly} value={line.discountPct} onChange={(e) => update(r, 'discountPct', e.target.value)} onKeyDown={(e) => onKeyDown(e, r, 3)} onPaste={(e) => onPaste(e, r, 3)} />
              </Cell>
              <Cell error={cellErrors[`${r}:taxCode`]}>
                <select data-cell={`${r}:4`} aria-label={headers.taxCode} className="h-7 w-full rounded-md border border-surface-line bg-surface px-1" disabled={readOnly} value={line.taxCode} onChange={(e) => update(r, 'taxCode', e.target.value)} onKeyDown={(e) => onKeyDown(e, r, 4)}>
                  {taxCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Cell>
              <td className="px-2 py-1 text-end tabular-nums">
                <bdi dir="ltr">{amounts[r] ?? '0.00'}</bdi>
              </td>
              <td className="px-1 py-1">
                {readOnly ? null : (
                  <span className="flex gap-0.5">
                    <Button variant="ghost" aria-label={t('invoices.editor.duplicateLine')} title={t('invoices.editor.duplicateLine')} onClick={() => onChange(duplicateRow(lines, r, freshKey))}>
                      <Copy aria-hidden size={14} />
                    </Button>
                    <Button variant="ghost" aria-label={t('invoices.editor.removeLine')} title={t('invoices.editor.removeLine')} onClick={() => onChange(removeRow(lines, r))}>
                      <X aria-hidden size={14} />
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {readOnly ? null : (
        <div className="border-t border-surface-line p-1">
          <Button variant="ghost" onClick={() => onChange([...lines, { ...EMPTY_LINE(), taxCode: lines.at(-1)?.taxCode ?? 'SR' }])}>
            {t('invoices.editor.addLine')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Cell wrapper: shows the server field error for the cell. */
function Cell({ children, error }: { children: ReactNode; error?: string }) {
  return (
    <td className="px-1 py-0.5 align-top">
      {children}
      {error ? <span className="block text-[12px] text-red-700">{error}</span> : null}
    </td>
  );
}
