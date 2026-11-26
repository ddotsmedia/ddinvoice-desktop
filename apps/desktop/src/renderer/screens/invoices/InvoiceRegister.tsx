import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState, type ColumnSizingState, type RowSelectionState } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Input, type BadgeTone } from '@ddinvoice/ui';
import { fmt } from '../../lib/totals';
import { useSession } from '../../lib/session';
import { useCustomers, useInvoices, type InvoiceFilters } from '../../lib/queries';
import type { Customer, InvoiceSummary } from '../../lib/types';
import { toCsv } from '../../lib/csv';
import { loadJson, saveJson } from '../../lib/storage';
import { toast } from 'sonner';

const PAGE_SIZE = 50;

interface SavedView {
  name: string;
  filters: InvoiceFilters;
  visibility: VisibilityState;
}

const headerKey = (id: string) => (['document', 'payment', 'delivery', 'eInvoice'].includes(id) ? `invoices.status.${id}` : `invoices.${id}`);

const TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  UNPAID: 'warning',
  PARTIAL: 'info',
  PAID: 'success',
  OVERPAID: 'info',
  NOT_SENT: 'neutral',
  SENT: 'success',
  NOT_REQUIRED: 'neutral',
  PENDING: 'warning',
  SUBMITTED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
};

/** Server-paged invoice register: saved views, column show/resize (persisted per user), multi-select, CSV, preview. */
export function InvoiceRegister() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { me } = useSession();
  const userId = me?.id ?? 'anon';
  const [params, setParams] = useSearchParams();

  const filters: InvoiceFilters = useMemo(
    () => ({
      status: params.get('status') || undefined,
      settlement: params.get('settlement') || undefined,
      q: params.get('q') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      sort: (params.get('sort') as InvoiceFilters['sort']) || undefined,
      dir: (params.get('dir') as InvoiceFilters['dir']) || undefined,
    }),
    [params],
  );

  // Cursor stack: index = page number. Filter changes reset to the first page.
  const [pages, setPages] = useState<{ key: string; cursors: (string | undefined)[]; index: number }>({ key: '', cursors: [undefined], index: 0 });
  const filterKey = JSON.stringify(filters);
  const current = pages.key === filterKey ? pages : { key: filterKey, cursors: [undefined], index: 0 };
  const cursor = current.cursors[current.index];

  const list = useInvoices(filters, cursor, PAGE_SIZE);
  const customers = useCustomers();
  const customerById = useMemo(() => new Map((customers.data ?? []).map((c: Customer) => [c.id, c])), [customers.data]);

  const [visibility, setVisibility] = useState<VisibilityState>(() => loadJson(`ddi.invoices.columns.${userId}`, {}));
  const [sizing, setSizing] = useState<ColumnSizingState>(() => loadJson(`ddi.invoices.sizing.${userId}`, {}));
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>(() => loadJson(`ddi.invoices.views.${userId}`, []));
  const [viewName, setViewName] = useState('');

  const updateVisibility = (next: VisibilityState) => {
    setVisibility(next);
    saveJson(`ddi.invoices.columns.${userId}`, next);
  };
  const updateSizing = (next: ColumnSizingState) => {
    setSizing(next);
    saveJson(`ddi.invoices.sizing.${userId}`, next);
  };

  const columns = useMemo<ColumnDef<InvoiceSummary>[]>(() => {
    const cell = (id: string, render: (r: InvoiceSummary) => ReactNode, size = 120): ColumnDef<InvoiceSummary> => ({
      id,
      header: () => t(headerKey(id)),
      cell: ({ row }) => render(row.original),
      size,
      minSize: 60,
    });
    const chip = (value: string) => (
      <Badge tone={TONE[value] ?? 'neutral'}>{t(`invoices.status.${value}`)}</Badge>
    );
    return [
      {
        id: 'select',
        header: ({ table }) => (
          <input type="checkbox" aria-label={t('common.selected', { count: 0 })} checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} />
        ),
        cell: ({ row }) => <input type="checkbox" aria-label={row.id} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
        size: 36,
        enableResizing: false,
      },
      cell('number', (r) => <bdi dir="ltr">{r.number ?? '—'}</bdi>, 130),
      cell('customer', (r) => customerById.get(r.customerId)?.nameEn ?? '—', 200),
      cell('issueDate', (r) => <bdi dir="ltr">{r.issueDate}</bdi>, 110),
      cell('dueDate', (r) => <bdi dir="ltr">{r.dueDate}</bdi>, 110),
      cell('total', (r) => <span className="tabular-nums"><bdi dir="ltr">{fmt(r.total)}</bdi></span>, 110),
      cell('balance', (r) => <span className="tabular-nums"><bdi dir="ltr">{fmt(r.openBalance)}</bdi></span>, 110),
      cell('document', (r) => chip(r.status), 90),
      cell('payment', (r) => chip(r.settlementStatus), 110),
      cell('delivery', (r) => chip(r.deliveryStatus), 100),
      cell('eInvoice', (r) => chip(r.einvoiceStatus), 120),
    ];
  }, [customerById, t]);

  const rows = list.data?.items ?? [];
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility: visibility, columnSizing: sizing, rowSelection: selection },
    onColumnVisibilityChange: (u) => updateVisibility(typeof u === 'function' ? u(visibility) : u),
    onColumnSizingChange: (u) => updateSizing(typeof u === 'function' ? u(sizing) : u),
    onRowSelectionChange: setSelection,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    manualPagination: true,
  });

  const focused = rows.find((r) => r.id === focusId) ?? null;
  const selectedRows = rows.filter((r) => selection[r.id]);

  const setFilter = (key: keyof InvoiceFilters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const applyView = (v: SavedView) => {
    setParams(new URLSearchParams(Object.entries(v.filters).filter(([, x]) => x).map(([k, x]) => [k, String(x)])), { replace: true });
    updateVisibility(v.visibility);
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...views.filter((v) => v.name !== name), { name, filters, visibility }];
    setViews(next);
    saveJson(`ddi.invoices.views.${userId}`, next);
    setViewName('');
  };

  const exportCsv = async () => {
    const source = selectedRows.length > 0 ? selectedRows : rows;
    const csv = toCsv(
      ['number', 'customer', 'issueDate', 'dueDate', 'total', 'balance', 'document', 'payment', 'delivery', 'eInvoice'],
      source.map((r) => [
        r.number ?? '',
        customerById.get(r.customerId)?.nameEn ?? '',
        r.issueDate,
        r.dueDate,
        fmt(r.total),
        fmt(r.openBalance),
        r.status,
        r.settlementStatus,
        r.deliveryStatus,
        r.einvoiceStatus,
      ]),
    );
    const result = await window.ddi.file.saveAs({ suggestedName: 'invoices', extension: 'csv', dataBase64: base64Utf8(csv) });
    if (result.saved) toast.success(t('common.export'));
  };

  const pageIndex = current.index;
  const hasNext = !!list.data?.nextCursor;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <h1 className="me-2 text-[18px] font-semibold text-navy">{t('invoices.title')}</h1>
          <select aria-label={t('invoices.table.filterStatus')} className="h-7 rounded-md border border-surface-line bg-surface px-2" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">{t('invoices.table.allValues')}</option>
            <option value="DRAFT">{t('invoices.status.DRAFT')}</option>
            <option value="ISSUED">{t('invoices.status.ISSUED')}</option>
          </select>
          <select aria-label={t('invoices.table.filterPayment')} className="h-7 rounded-md border border-surface-line bg-surface px-2" value={filters.settlement ?? ''} onChange={(e) => setFilter('settlement', e.target.value)}>
            <option value="">{t('invoices.table.allValues')}</option>
            {(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`invoices.status.${s}`)}
              </option>
            ))}
          </select>
          <Input className="w-56" aria-label={t('common.search')} placeholder={t('common.search')} defaultValue={filters.q ?? ''} onKeyDown={(e) => e.key === 'Enter' && setFilter('q', (e.target as HTMLInputElement).value.trim())} />
          <Button variant="primary" onClick={() => navigate('/sales/invoices/new')}>
            {t('invoices.new')}
          </Button>
          <Button variant="secondary" onClick={() => void exportCsv()}>
            {t('common.export')}
          </Button>
          <details className="relative">
            <summary className="inline-flex h-7 cursor-pointer list-none items-center rounded-md border border-surface-line bg-surface px-2.5">{t('invoices.table.showColumns')}</summary>
            <div className="absolute end-0 z-10 mt-1 w-44 rounded-md border border-surface-line bg-surface p-2 shadow-md">
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                  <span>{t(`invoices.${c.id}`, { defaultValue: c.id })}</span>
                </label>
              ))}
            </div>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-navy-muted">
          <span>{t('invoices.table.views')}:</span>
          {views.map((v) => (
            <Button key={v.name} variant="ghost" onClick={() => applyView(v)}>
              {v.name}
            </Button>
          ))}
          <Input className="w-36" aria-label={t('invoices.table.saveView')} value={viewName} onChange={(e) => setViewName(e.target.value)} />
          <Button variant="secondary" onClick={saveView} disabled={!viewName.trim()}>
            {t('invoices.table.saveView')}
          </Button>
          {selectedRows.length > 0 ? <span className="ms-auto">{t('common.selected', { count: selectedRows.length })}</span> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-surface-line bg-surface">
          {list.isError ? (
            <p role="alert" className="p-3 text-red-700">
              {t('errors.generic')}
            </p>
          ) : null}
          <table className="w-full border-collapse text-body" style={{ width: table.getTotalSize() }}>
            <thead className="sticky top-0 bg-surface-muted">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id} className="relative border-b border-surface-line px-2 py-1 text-start font-medium text-navy-muted" style={{ width: h.getSize() }}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanResize() ? (
                        <span
                          onMouseDown={h.getResizeHandler()}
                          onTouchStart={h.getResizeHandler()}
                          className="absolute end-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-cobalt"
                        />
                      ) : null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setFocusId(row.original.id)}
                  className={`cursor-default border-b border-surface-line hover:bg-surface-muted ${focusId === row.original.id ? 'bg-cobalt-soft' : ''}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-2 py-1 align-middle" style={{ width: cell.column.getSize() }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {!list.isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="p-4 text-center text-navy-muted">
                    {t('common.noResults')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={pageIndex === 0} onClick={() => setPages({ key: filterKey, cursors: current.cursors, index: pageIndex - 1 })}>
            {t('common.back')}
          </Button>
          <Button
            variant="secondary"
            disabled={!hasNext}
            onClick={() => {
              const nextCursor = list.data?.nextCursor ?? undefined;
              if (!nextCursor) return;
              setPages({ key: filterKey, cursors: [...current.cursors.slice(0, pageIndex + 1), nextCursor], index: pageIndex + 1 });
            }}
          >
            {t('common.next')}
          </Button>
        </div>
      </div>

      <aside className="hidden w-72 shrink-0 overflow-auto border-s border-surface-line bg-surface p-3 xl:block" aria-label={t('invoices.preview')}>
        <h2 className="mb-2 font-medium text-navy">{t('invoices.preview')}</h2>
        {focused ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-navy-muted">{t('invoices.number')}</dt>
            <dd>
              <bdi dir="ltr">{focused.number ?? '—'}</bdi>
            </dd>
            <dt className="text-navy-muted">{t('invoices.customer')}</dt>
            <dd>{customerById.get(focused.customerId)?.nameEn ?? '—'}</dd>
            <dt className="text-navy-muted">{t('invoices.total')}</dt>
            <dd>
              <bdi dir="ltr">{fmt(focused.total)}</bdi> {focused.currency}
            </dd>
            <dt className="text-navy-muted">{t('invoices.balance')}</dt>
            <dd>
              <bdi dir="ltr">{fmt(focused.openBalance)}</bdi>
            </dd>
          </dl>
        ) : (
          <p className="text-navy-muted">{t('invoices.previewEmpty')}</p>
        )}
        {focused ? (
          <div className="mt-3 space-y-2">
            {focused.status === 'ISSUED' ? <p className="text-navy-muted">{t('invoices.pdfArchived')}</p> : null}
            <Link to={`/sales/invoices/${focused.id}`} className="text-cobalt hover:underline">
              {t('invoices.editor.title')}
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** UTF-8 bytes → base64 without relying on Node Buffer. BOM first so Excel reads Arabic correctly. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(`﻿${text}`);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
