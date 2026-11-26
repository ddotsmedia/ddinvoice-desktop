import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Input } from '@ddinvoice/ui';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useApi, useCustomers, useInvoice, useTaxCodes } from '../../lib/queries';
import { computeTotals, fmt, type EditableLine } from '../../lib/totals';
import { ConflictDialog } from './ConflictDialog';
import { usePresence } from '../../lib/live';
import { OUTBOX_CHANGED, persistentOutbox } from '../../lib/outbox';
import { conflictFields, type FieldConflict } from './conflict';
import type { InvoiceDetail, TaxCodeRow } from '../../lib/types';
import { buildInvoiceBody, EMPTY_LINE, splitFieldErrors, type HeaderValues } from './invoice-payload';
import { LineGrid, type GridLine } from './LineGrid';
import { CustomerCombobox } from './CustomerCombobox';

const AUTOSAVE_MS = 5000;
const todayIso = () => new Date().toISOString().slice(0, 10);
const issueKeyStorage = (id: string) => `ddi.issue.${id}`;

const EMPTY_HEADER = (): HeaderValues => ({ customerId: '', supplyDate: todayIso(), currency: 'AED', fxRate: '', terms: '', notes: '' });

/**
 * Invoice editor. Draft saves are PATCHed every 5s while dirty and on Ctrl+S. Issue saves first, then POSTs /issue with an
 * Idempotency-Key stored with the draft until it succeeds, so a retry after a dropped response cannot issue twice.
 */
export function InvoiceEditor() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const { permissions, me } = useSession();
  const existing = useInvoice(id);
  const customers = useCustomers();
  const taxCodes = useTaxCodes();

  const [draftId, setDraftId] = useState<string | null>(id ?? null);
  const presence = usePresence(draftId ?? undefined);
  const otherEditor = presence && presence.userId !== me?.id ? presence : null;
  const [header, setHeader] = useState<HeaderValues>(EMPTY_HEADER);
  const [lines, setLines] = useState<GridLine[]>(() => [EMPTY_LINE()]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<{ header: Record<string, string>; cells: Record<string, string> }>({ header: {}, cells: {} });
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const revRef = useRef(0);
  /** Version of the draft this client last saw or wrote; sent as If-Match on every PATCH. */
  const versionRef = useRef<number | null>(null);
  const [conflict, setConflict] = useState<{ theirs: InvoiceDetail; fields: FieldConflict[] } | null>(null);
  const createKeyRef = useRef<string>(crypto.randomUUID());

  const isIssued = existing.data?.status === 'ISSUED';
  const readOnly = isIssued || (!!id && !permissions.has('invoice.update')) || (!id && !permissions.has('invoice.create'));
  const codes: TaxCodeRow[] = taxCodes.data ?? [];
  const codeById = new Map(codes.map((c) => [c.id, c.code]));

  // Hydrate from the server copy, but never over edits the user is still making.
  useEffect(() => {
    if (!existing.data || dirty || codes.length === 0) return;
    setHeader(headerFrom(existing.data));
    setLines(linesFrom(existing.data, codeById));
    setDraftId(existing.data.id);
    versionRef.current = existing.data.version;
  }, [existing.data, codes.length]);

  // Presence heartbeat every 10 s while this draft is open and editable; the server fans it out to other clients.
  useEffect(() => {
    if (!draftId || readOnly) return;
    const beat = () => {
      api.post(`/invoices/${draftId}/presence`).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, 10_000);
    return () => clearInterval(timer);
  }, [api, draftId, readOnly]);

  const edit = useCallback((fn: () => void) => {
    fn();
    revRef.current += 1;
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly || saving) return false;
    if (!header.customerId) {
      setErrors({ header: { customerId: t('validation.required') }, cells: {} });
      return false;
    }
    let body: ReturnType<typeof buildInvoiceBody>;
    try {
      body = buildInvoiceBody(header, lines, codes);
    } catch {
      toast.error(t('errors.generic'));
      return false;
    }
    const rev = revRef.current;
    setSaving(true);
    try {
      if (!draftId) {
        const created = await api.post<InvoiceDetail>('/invoices', { body, idempotencyKey: createKeyRef.current });
        setDraftId(created.id);
        versionRef.current = created.version;
        await qc.invalidateQueries({ queryKey: ['invoices'] });
        navigate(`/sales/invoices/${created.id}`, { replace: true });
      } else {
        const saved = await api.patch<InvoiceDetail>(`/invoices/${draftId}`, {
          body,
          ifMatch: versionRef.current ?? existing.data?.version ?? 1,
        });
        versionRef.current = saved.version;
        await qc.invalidateQueries({ queryKey: ['invoices'] });
      }
      if (rev === revRef.current) setDirty(false);
      setSavedAt(new Date());
      setErrors({ header: {}, cells: {} });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT' && e.extra.current) {
        // Someone else saved first: show mine vs theirs and let the user choose. Nothing is overwritten silently.
        const theirs = e.extra.current as InvoiceDetail;
        const customerName = (cid: string) => customers.data?.find((c) => c.id === cid)?.nameEn ?? cid;
        setConflict({ theirs, fields: conflictFields({ header, lines }, theirs, customerName) });
        return false;
      }
      if (e instanceof ApiError && Object.keys(e.fields).length > 0) setErrors(splitFieldErrors(e.fields));
      toast.error(e instanceof ApiError ? t(e.messageKey) : t('errors.generic'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [api, codes, customers.data, draftId, existing.data?.version, header, lines, navigate, qc, readOnly, saving, t]);

  const keepMine = async () => {
    if (!conflict) return;
    versionRef.current = conflict.theirs.version;
    setConflict(null);
    await save();
  };

  const useTheirs = () => {
    if (!conflict) return;
    const theirs = conflict.theirs;
    setHeader(headerFrom(theirs));
    setLines(linesFrom(theirs, codeById));
    versionRef.current = theirs.version;
    setDirty(false);
    setConflict(null);
  };

  // Autosave every 5s while there are unsaved changes. The interval reads the latest save through a ref.
  const saveRef = useRef(save);
  saveRef.current = save;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(() => {
      if (dirtyRef.current) void saveRef.current();
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, [readOnly]);

  // Ctrl+S saves immediately.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const totals = computeTotals(lines);

  const issue = async () => {
    if (!draftId) {
      toast.message(t('invoices.editor.createFirst'));
      return;
    }
    if (dirty && !(await save())) return;
    setIssueOpen(true);
  };

  const confirmIssue = async () => {
    if (!draftId) return;
    const storageKey = issueKeyStorage(draftId);
    const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    setIssuing(true);
    try {
      const issued = await api.post<InvoiceDetail>(`/invoices/${draftId}/issue`, { idempotencyKey: key });
      sessionStorage.removeItem(storageKey);
      setIssueOpen(false);
      toast.success(t('invoices.editor.issued', { number: issued.number }));
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      await qc.invalidateQueries({ queryKey: ['invoice', draftId] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Server unreachable: keep the command with the same Idempotency-Key and send it when the server is back.
        persistentOutbox().enqueue({ method: 'POST', path: `/invoices/${draftId}/issue`, idempotencyKey: key });
        window.dispatchEvent(new Event(OUTBOX_CHANGED));
        setIssueOpen(false);
        toast.message(t('invoices.editor.queuedIssue'));
        return;
      }
      toast.error(e instanceof ApiError ? t(e.messageKey) : t('errors.generic'));
    } finally {
      setIssuing(false);
    }
  };

  const customerName = (customers.data ?? []).find((c) => c.id === header.customerId);
  const number = existing.data?.number;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[18px] font-semibold text-navy">
          {number ? <bdi dir="ltr">{number}</bdi> : t('invoices.editor.draftTitle')}
        </h1>
        {!draftId ? <Badge tone="warning">{t('invoices.editor.unsyncedDraft')}</Badge> : null}
        {isIssued ? <Badge tone="info">{t('invoices.status.ISSUED')}</Badge> : null}
        {otherEditor ? <Badge tone="info">{t('presence.editing', { user: otherEditor.userName })}</Badge> : null}
        <span className="ms-auto text-navy-muted" aria-live="polite">
          {saving ? t('invoices.editor.autosaving') : savedAt ? t('invoices.editor.savedAt', { time: savedAt.toLocaleTimeString() }) : ''}
        </span>
        {readOnly ? null : (
          <Button variant="secondary" onClick={() => void save()} disabled={saving}>
            {t('invoices.editor.saveDraft')}
          </Button>
        )}
        {readOnly || !permissions.has('invoice.issue') ? null : (
          <Button variant="primary" onClick={() => void issue()} disabled={saving}>
            {t('invoices.editor.issue')}
          </Button>
        )}
      </div>

      {isIssued ? <p className="rounded border border-cobalt-soft bg-cobalt-soft px-3 py-1.5 text-navy">{t('invoices.editor.readOnly')}</p> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <span className="mb-1 block text-navy-muted">{t('invoices.editor.customer')}</span>
          <CustomerCombobox
            customers={customers.data ?? []}
            value={customerName ?? null}
            disabled={readOnly}
            error={errors.header.customerId}
            onSelect={(c) => edit(() => setHeader((h) => ({ ...h, customerId: c.id })))}
          />
        </div>
        <Field label={t('invoices.editor.supplyDate')} error={errors.header.supplyDate}>
          <Input type="date" dir="ltr" disabled={readOnly} value={header.supplyDate} onChange={(e) => edit(() => setHeader((h) => ({ ...h, supplyDate: e.target.value })))} />
        </Field>
        <Field label={t('invoices.editor.currency')} error={errors.header.currency}>
          <Input dir="ltr" disabled={readOnly} maxLength={3} value={header.currency} onChange={(e) => edit(() => setHeader((h) => ({ ...h, currency: e.target.value.toUpperCase() })))} />
        </Field>
        <Field label={t('invoices.editor.fxRate')} error={errors.header.fxRate}>
          <Input dir="ltr" inputMode="decimal" disabled={readOnly} value={header.fxRate} onChange={(e) => edit(() => setHeader((h) => ({ ...h, fxRate: e.target.value })))} />
        </Field>
        <Field label={t('invoices.editor.terms')} error={errors.header.terms}>
          <Input disabled={readOnly} value={header.terms} onChange={(e) => edit(() => setHeader((h) => ({ ...h, terms: e.target.value })))} />
        </Field>
        <Field label={t('invoices.editor.notes')} error={errors.header.notes}>
          <Input disabled={readOnly} value={header.notes} onChange={(e) => edit(() => setHeader((h) => ({ ...h, notes: e.target.value })))} />
        </Field>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <LineGrid
          lines={lines}
          amounts={totals.lineAmounts}
          taxCodes={codes.map((c) => c.code)}
          readOnly={readOnly}
          cellErrors={errors.cells}
          onChange={(next) => edit(() => setLines(next))}
        />
      </div>

      <div className="flex justify-end">
        <dl className="grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-surface-line bg-surface p-3 tabular-nums">
          <dt className="text-navy-muted">{t('invoices.editor.subtotal')}</dt>
          <dd><bdi dir="ltr">{totals.subtotal}</bdi></dd>
          <dt className="text-navy-muted">{t('invoices.editor.discountTotal')}</dt>
          <dd><bdi dir="ltr">{totals.discountTotal}</bdi></dd>
          <dt className="text-navy-muted">{t('invoices.editor.tax')}</dt>
          <dd><bdi dir="ltr">{totals.taxTotal}</bdi></dd>
          <dt className="font-semibold text-navy">{t('invoices.editor.grandTotal')}</dt>
          <dd className="font-semibold"><bdi dir="ltr">{totals.total}</bdi></dd>
        </dl>
      </div>

      <ConflictDialog
        open={conflict !== null}
        conflicts={conflict?.fields ?? []}
        onKeepMine={() => void keepMine()}
        onUseTheirs={useTheirs}
        onClose={() => setConflict(null)}
      />

      <Dialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        title={t('invoices.editor.issueTitle')}
        description={t('invoices.editor.issueBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIssueOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void confirmIssue()} disabled={issuing}>
              {t('invoices.editor.confirmIssue')}
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-navy-muted">{t('invoices.customer')}</dt>
          <dd>{customerName?.nameEn ?? '—'}</dd>
          <dt className="text-navy-muted">{t('invoices.editor.subtotal')}</dt>
          <dd><bdi dir="ltr">{fmt(totals.subtotal)}</bdi></dd>
          <dt className="text-navy-muted">{t('invoices.editor.tax')}</dt>
          <dd><bdi dir="ltr">{fmt(totals.taxTotal)}</bdi></dd>
          <dt className="font-semibold text-navy">{t('invoices.editor.grandTotal')}</dt>
          <dd className="font-semibold"><bdi dir="ltr">{fmt(totals.total)}</bdi></dd>
        </dl>
      </Dialog>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-navy-muted">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-red-700">{error}</span> : null}
    </label>
  );
}

export function headerFrom(inv: InvoiceDetail): HeaderValues {
  return {
    customerId: inv.customerId,
    supplyDate: inv.supplyDate,
    currency: inv.currency,
    fxRate: inv.fxRate === '1' || inv.fxRate === '1.000000' ? '' : inv.fxRate,
    terms: inv.terms,
    notes: inv.notes,
  };
}

export function linesFrom(inv: InvoiceDetail, codeById: Map<string, string>): GridLine[] {
  return inv.lines.map((l) => ({
    key: l.id,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
    taxCode: (codeById.get(l.taxCodeId ?? '') ?? 'SR') as EditableLine['taxCode'],
  }));
}
