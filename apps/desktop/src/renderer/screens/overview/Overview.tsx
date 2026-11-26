import { Decimal } from '@ddinvoice/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { fmt } from '../../lib/totals';
import { useApi } from '../../lib/queries';
import type { InvoiceSummary, Page } from '../../lib/types';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Figures are computed from the server's invoice pages. Each figure opens the filtered register. */
export function Overview() {
  const { t } = useTranslation();
  const api = useApi();
  const drafts = useQuery({
    queryKey: ['overview', 'drafts'],
    queryFn: () => api.get<Page<InvoiceSummary>>('/invoices', { query: { status: 'DRAFT', limit: 5 } }),
  });
  const unpaid = useQuery({
    queryKey: ['overview', 'unpaid'],
    queryFn: () => api.get<Page<InvoiceSummary>>('/invoices', { query: { settlement: 'UNPAID', limit: 200 } }),
  });
  const partial = useQuery({
    queryKey: ['overview', 'partial'],
    queryFn: () => api.get<Page<InvoiceSummary>>('/invoices', { query: { settlement: 'PARTIAL', limit: 200 } }),
  });

  const open = [...(unpaid.data?.items ?? []), ...(partial.data?.items ?? [])];
  const truncated = !!(unpaid.data?.nextCursor || partial.data?.nextCursor);
  const receivables = open.reduce((s, i) => s.plus(i.openBalance), new Decimal(0));
  const today = todayIso();
  const overdue = open.filter((i) => i.dueDate < today);
  const overdueTotal = overdue.reduce((s, i) => s.plus(i.openBalance), new Decimal(0));
  const loading = drafts.isLoading || unpaid.isLoading || partial.isLoading;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-[18px] font-semibold text-navy">{t('overview.title')}</h1>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Figure
          label={t('overview.receivables')}
          value={loading ? '…' : `${truncated ? '≥ ' : ''}${fmt(receivables)}`}
          to="/sales/invoices?settlement=UNPAID"
          linkLabel={t('overview.viewAll')}
        />
        <Figure label={t('overview.overdue')} value={loading ? '…' : `${truncated ? '≥ ' : ''}${fmt(overdueTotal)}`} to="/sales/invoices?settlement=UNPAID&sort=issueDate&dir=asc" linkLabel={t('overview.viewAll')} />
        <Figure label={t('overview.collectedMonth')} value="—" to="/sales/invoices" linkLabel={t('overview.viewAll')} />
        <Figure
          label={t('overview.drafts')}
          value={drafts.data ? `${drafts.data.items.length}${drafts.data.nextCursor ? '+' : ''}` : '…'}
          to="/sales/invoices?status=DRAFT"
          linkLabel={t('overview.viewAll')}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Queue title={t('overview.queueDrafts')} rows={drafts.data?.items ?? []} />
        <Queue title={t('overview.queueOverdue')} rows={overdue.slice(0, 5)} />
      </div>
    </div>
  );
}

function Figure({ label, value, to, linkLabel }: { label: string; value: string; to: string; linkLabel: string }) {
  return (
    <div className="rounded-lg border border-surface-line bg-surface p-3">
      <div className="text-navy-muted">{label}</div>
      <div className="mt-1 text-[20px] font-semibold text-navy tabular-nums">
        <bdi dir="ltr">{value}</bdi>
      </div>
      <Link to={to} className="mt-1 inline-block text-cobalt hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}

function Queue({ title, rows }: { title: string; rows: InvoiceSummary[] }) {
  return (
    <section className="rounded-lg border border-surface-line bg-surface">
      <h2 className="border-b border-surface-line px-3 py-2 font-medium text-navy">{title}</h2>
      <ul>
        {rows.length === 0 ? <li className="px-3 py-2 text-navy-muted">—</li> : null}
        {rows.map((r) => (
          <li key={r.id} className="flex justify-between border-b border-surface-line px-3 py-1.5 last:border-0">
            <Link to={`/sales/invoices/${r.id}`} className="text-cobalt hover:underline">
              <bdi dir="ltr">{r.number ?? r.id.slice(0, 8)}</bdi>
            </Link>
            <span className="tabular-nums">
              <bdi dir="ltr">{fmt(r.openBalance)}</bdi>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
