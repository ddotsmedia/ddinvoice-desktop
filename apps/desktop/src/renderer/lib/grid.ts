/** Pure grid helpers for the invoice line editor. The component wires these to key events. */

export interface Cell {
  row: number;
  col: number;
}

export type GridKey = 'Enter' | 'Tab' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Next cell for a navigation key. Enter moves down a row (Excel-style); Tab moves right and wraps to the next row;
 * Shift+Tab is the reverse. Arrows clamp at the grid edges. Returns null when the key is not a navigation key.
 */
export function moveCell(at: Cell, key: GridKey, shift: boolean, rows: number, cols: number): Cell | null {
  if (rows <= 0 || cols <= 0) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max - 1);
  switch (key) {
    case 'Enter':
      return { row: clamp(at.row + (shift ? -1 : 1), rows), col: at.col };
    case 'ArrowUp':
      return { row: clamp(at.row - 1, rows), col: at.col };
    case 'ArrowDown':
      return { row: clamp(at.row + 1, rows), col: at.col };
    case 'ArrowLeft':
      return { row: at.row, col: clamp(at.col - 1, cols) };
    case 'ArrowRight':
      return { row: at.row, col: clamp(at.col + 1, cols) };
    case 'Tab': {
      const linear = at.row * cols + at.col + (shift ? -1 : 1);
      if (linear < 0 || linear >= rows * cols) return { row: clamp(linear < 0 ? 0 : rows - 1, rows), col: linear < 0 ? 0 : cols - 1 };
      return { row: Math.floor(linear / cols), col: linear % cols };
    }
  }
}

/** Inserts a copy of row `index` below it. `clone` lets callers give the copy a fresh identity (e.g. a React key). */
export function duplicateRow<T>(rows: T[], index: number, clone: (row: T) => T = shallowClone): T[] {
  if (index < 0 || index >= rows.length) return rows;
  return [...rows.slice(0, index + 1), clone(rows[index]!), ...rows.slice(index + 1)];
}

function shallowClone<T>(row: T): T {
  return typeof row === 'object' && row !== null ? { ...row } : row;
}

export function removeRow<T>(rows: T[], index: number): T[] {
  if (rows.length <= 1 || index < 0 || index >= rows.length) return rows;
  return rows.filter((_, i) => i !== index);
}

/** Parses clipboard text copied from Excel/Sheets: rows split by newline, cells by tab. Trailing blank line ignored. */
export function parsePaste(text: string): string[][] {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (trimmed === '') return [];
  return trimmed.split('\n').map((line) => line.split('\t').map((c) => c.trim()));
}
