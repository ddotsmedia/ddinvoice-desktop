// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../i18n';
import type { GridLine } from './LineGrid';

const { LineGrid } = await import('./LineGrid');

const line = (key: string, description: string): GridLine => ({ key, description, qty: '1', unitPrice: '10', discountPct: '0', taxCode: 'SR' });
const lines = [line('a', 'First'), line('b', 'Second')];

function renderGrid(onChange = vi.fn(), readOnly = false) {
  render(<LineGrid lines={lines} amounts={['10.00', '10.00']} taxCodes={['SR', 'ZR']} readOnly={readOnly} cellErrors={{}} onChange={onChange} />);
  return onChange;
}

describe('invoice line grid keyboard', () => {
  beforeAll(async () => {
    await initI18n('en');
  });
  afterEach(() => cleanup());

  it('Enter moves focus to the same column of the next row', () => {
    renderGrid();
    const first = screen.getAllByLabelText('Description')[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[1]);
  });

  it('Tab moves across the row to the next cell', () => {
    renderGrid();
    const qty = screen.getAllByLabelText('Qty')[0]!;
    qty.focus();
    fireEvent.keyDown(qty, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(screen.getAllByLabelText('Unit price')[0]);
  });

  it('Ctrl+D duplicates the current row', () => {
    const onChange = renderGrid();
    fireEvent.keyDown(screen.getAllByLabelText('Description')[0]!, { key: 'd', ctrlKey: true });
    const next = onChange.mock.calls[0]![0] as GridLine[];
    expect(next.map((l) => l.description)).toEqual(['First', 'First', 'Second']);
  });

  it('Enter on the last row adds a line', () => {
    const onChange = renderGrid();
    fireEvent.keyDown(screen.getAllByLabelText('Description')[1]!, { key: 'Enter' });
    expect((onChange.mock.calls[0]![0] as GridLine[]).length).toBe(3);
  });

  it('read-only grid disables editing', () => {
    renderGrid(vi.fn(), true);
    expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
