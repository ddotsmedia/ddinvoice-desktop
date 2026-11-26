import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ddinvoice/ui';
import { ApiError } from '../../lib/api';
import { useApi } from '../../lib/queries';
import { diskWarn, formatBytes, useBackups, useLicense, useOpsHealth, useOpsMutation, useRecovery, type ExportResult, type FailedJob } from '../../lib/ops';
import { useSession } from '../../lib/session';

/** Settings > Server health, Backup, Help, Export and License. Each screen reads one ops endpoint and sends commands through useOpsMutation. */

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-[18px] font-semibold text-navy">{title}</h1>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-surface-line bg-surface p-3">
      <h2 className="mb-2 text-[14px] font-semibold text-navy">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-surface-line py-1 last:border-0">
      <span className="text-navy-muted">{label}</span>
      <span className="text-end">{value}</span>
    </div>
  );
}

function errorText(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) return e.status === 422 ? t('ops.license.invalid') : t(e.messageKey);
  return t('errors.generic');
}

/** Converts bytes to base64 without spreading a large array into arguments. */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function ServerHealth() {
  const { t } = useTranslation();
  const health = useOpsHealth();
  const retry = useOpsMutation((api, id: string) => api.post(`/ops/outbox/${id}/retry`));
  const dismiss = useOpsMutation((api, id: string) => api.post(`/ops/outbox/${id}/dismiss`));
  const h = health.data;
  if (!h) return <Page title={t('ops.health.title')}>{health.isError ? <p role="alert">{t('errors.generic')}</p> : <p>…</p>}</Page>;

  const dateText = (iso: string | null) => (iso ? <bdi>{new Date(iso).toLocaleString()}</bdi> : t('ops.never'));
  return (
    <Page title={t('ops.health.title')}>
      {h.disk.warn ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          {t('ops.health.diskWarn', { gb: h.disk.warnBelowGb })}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title={t('ops.health.services')}>
          <Row label={t('ops.health.api')} value={t(`ops.state.${h.services.api.state}`, { defaultValue: h.services.api.state })} />
          <Row label={t('ops.health.postgres')} value={t(`ops.state.${h.services.postgres.state}`, { defaultValue: h.services.postgres.state })} />
          <Row label={t('ops.health.worker')} value={t(`ops.state.${h.services.worker.state}`, { defaultValue: h.services.worker.state })} />
          <Row label={t('ops.health.dbSize')} value={formatBytes(h.database.sizeBytes)} />
          <Row label={t('ops.health.disk')} value={<span className={diskWarn(h.disk.freeGb) ? 'font-semibold text-amber-800' : ''}>{h.disk.freeGb === null ? '—' : `${h.disk.freeGb} GB`}</span>} />
        </Section>
        <Section title={t('ops.health.backup')}>
          <Row label={t('ops.health.lastBackup')} value={dateText(h.backup.lastGoodAt)} />
          <Row label={t('ops.health.kind')} value={h.backup.lastGoodKind ?? '—'} />
          <Row label={t('ops.health.stale')} value={h.backup.stale ? t('common.yes') : t('common.no')} />
        </Section>
        <Section title={t('ops.health.queue')}>
          {Object.entries(h.queue).map(([k, v]) => (
            <Row key={k} label={t(`ops.queue.${k}`, { defaultValue: k })} value={<bdi>{v}</bdi>} />
          ))}
        </Section>
        <Section title={t('ops.health.certificate')}>
          {h.certificate ? (
            <Row label={t('ops.health.expires')} value={<bdi>{t('ops.health.daysLeft', { days: h.certificate.daysLeft })}</bdi>} />
          ) : (
            <p className="text-navy-muted">{t('ops.health.noCertificate')}</p>
          )}
        </Section>
        <Section title={t('ops.health.versions')}>
          <Row label={t('ops.health.server')} value={<bdi>{h.versions.server}</bdi>} />
          <Row label={t('ops.health.migrations')} value={<bdi>{h.migrations.applied}</bdi>} />
        </Section>
        <Section title={t('ops.health.devices')}>
          {h.connectedDevices.length === 0 ? <p className="text-navy-muted">{t('ops.health.noDevices')}</p> : null}
          {h.connectedDevices.map((d, i) => (
            <Row key={i} label={<bdi>{d.deviceName}</bdi>} value={dateText(d.lastSeenAt)} />
          ))}
        </Section>
      </div>
      <Section title={t('ops.health.failedJobs')}>
        {h.failedJobs.length === 0 ? <p className="text-navy-muted">{t('ops.health.noFailedJobs')}</p> : null}
        <ul className="space-y-2">
          {h.failedJobs.map((j: FailedJob) => (
            <li key={j.id} className="flex flex-wrap items-center gap-2 border-b border-surface-line pb-2">
              <span className="font-medium">{j.topic}</span>
              <span className="text-navy-muted">
                <bdi>{j.attempts}</bdi> {t('ops.health.attempts')}
              </span>
              {j.external ? <span className="text-amber-800">{t('ops.health.external')}</span> : null}
              <span className="min-w-0 flex-1 truncate text-navy-muted">{j.lastError ?? ''}</span>
              <Button variant="secondary" onClick={() => retry.mutate(j.id)} disabled={retry.isPending}>
                {t('ops.health.retry')}
              </Button>
              <Button variant="ghost" onClick={() => dismiss.mutate(j.id)} disabled={dismiss.isPending}>
                {t('ops.health.dismiss')}
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}

export function Backup() {
  const { t } = useTranslation();
  const backups = useBackups();
  const recovery = useRecovery();
  const [reviewed, setReviewed] = useState(false);
  const runNow = useOpsMutation((api) => api.post<unknown>('/ops/backups/run'));
  const release = useOpsMutation((api) => api.post<unknown>('/ops/recovery/release'));
  const rec = recovery.data;

  return (
    <Page title={t('ops.backup.title')}>
      {rec?.recoveryMode ? (
        <Section title={t('ops.backup.recoveryTitle')}>
          <p className="mb-2">{t('ops.backup.recoveryText')}</p>
          {rec.pending.length === 0 ? <p className="text-navy-muted">{t('ops.backup.recoveryNone')}</p> : null}
          <ul className="mb-3 space-y-1">
            {rec.pending.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="font-medium">{p.topic}</span>
                <span className="text-navy-muted">{p.status}</span>
                <span className="min-w-0 flex-1 truncate text-navy-muted">{p.lastError ?? ''}</span>
              </li>
            ))}
          </ul>
          <label className="mb-2 flex items-center gap-2">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            {t('ops.backup.reviewed')}
          </label>
          <Button onClick={() => release.mutate(undefined)} disabled={!reviewed || release.isPending}>
            {t('ops.backup.release')}
          </Button>
        </Section>
      ) : null}

      <Section title={t('ops.backup.actions')}>
        <div className="flex items-center gap-3">
          <Button onClick={() => runNow.mutate(undefined)} disabled={runNow.isPending}>
            {runNow.isPending ? t('ops.backup.running') : t('ops.backup.runNow')}
          </Button>
          {runNow.isError ? <span role="alert">{errorText(runNow.error, t)}</span> : null}
        </div>
        <p className="mt-3 text-navy-muted">{t('ops.backup.restoreHint')}</p>
        <code className="mt-1 block rounded bg-surface-muted p-2 text-[12px]">
          <bdi>{t('ops.backup.restoreCommand')}</bdi>
        </code>
      </Section>

      <Section title={t('ops.backup.list')}>
        <table className="w-full text-start">
          <thead>
            <tr className="text-navy-muted">
              <th className="py-1 text-start">{t('ops.backup.kind')}</th>
              <th className="py-1 text-start">{t('ops.backup.target')}</th>
              <th className="py-1 text-start">{t('ops.backup.status')}</th>
              <th className="py-1 text-start">{t('ops.backup.at')}</th>
            </tr>
          </thead>
          <tbody>
            {(backups.data ?? []).map((b) => (
              <tr key={b.id} className="border-t border-surface-line">
                <td className="py-1">{b.kind}</td>
                <td className="py-1">{b.target}</td>
                <td className="py-1">{b.status}</td>
                <td className="py-1">
                  <bdi>{new Date(b.at).toLocaleString()}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {backups.data && backups.data.length === 0 ? <p className="text-navy-muted">{t('ops.backup.none')}</p> : null}
      </Section>
    </Page>
  );
}

export function SupportHelp() {
  const { t } = useTranslation();
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function download() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const bytes = await api.getBytes('/ops/support-bundle');
      const day = new Date().toISOString().slice(0, 10);
      const res = await window.ddi.file.saveAs({ suggestedName: `ddinvoice-support-${day}`, extension: 'zip', dataBase64: toBase64(bytes) });
      setSaved(res.saved);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('ops.help.title')}>
      <Section title={t('ops.help.supportBundle')}>
        <p className="mb-3">{t('ops.help.description')}</p>
        <Button onClick={() => void download()} disabled={busy}>
          {busy ? t('ops.help.preparing') : t('ops.help.download')}
        </Button>
        {saved ? <p className="mt-2 text-navy-muted">{t('ops.help.saved')}</p> : null}
        {error ? <p role="alert" className="mt-2">{error}</p> : null}
      </Section>
    </Page>
  );
}

export function DataExport() {
  const { t } = useTranslation();
  const exp = useOpsMutation((api) => api.post<ExportResult>('/ops/export'));
  const r = exp.data;
  return (
    <Page title={t('ops.export.title')}>
      <Section title={t('ops.export.company')}>
        <p className="mb-3">{t('ops.export.description')}</p>
        <Button onClick={() => exp.mutate(undefined)} disabled={exp.isPending}>
          {exp.isPending ? t('ops.export.running') : t('ops.export.run')}
        </Button>
        {exp.isError ? <p role="alert" className="mt-2">{errorText(exp.error, t)}</p> : null}
        {r ? (
          <div className="mt-3 space-y-1">
            <p>
              {t('ops.export.folder')}: <bdi>{r.folder}</bdi>
            </p>
            <p>
              {t('ops.export.documents')}: <bdi>{r.documents}</bdi>
            </p>
            <ul>
              {r.tables.map((tb) => (
                <li key={tb.name}>
                  <bdi>{tb.name}</bdi>: <bdi>{tb.rows}</bdi>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
    </Page>
  );
}

export function License() {
  const { t } = useTranslation();
  const { permissions } = useSession();
  const lic = useLicense();
  const [text, setText] = useState('');
  const install = useOpsMutation((api, licenseKey: string) => api.post<unknown>('/ops/license', { body: { licenseKey } }));
  const l = lic.data;
  return (
    <Page title={t('ops.license.title')}>
      {l ? (
        <Section title={t('ops.license.state')}>
          <Row label={t('ops.license.mode')} value={t(l.mode === 'READ_ONLY' ? 'ops.license.readOnly' : 'ops.license.full')} />
          <Row label={t('ops.license.reason')} value={l.reason ?? '—'} />
          <Row label={t('ops.license.seats')} value={<bdi>{l.seats}</bdi>} />
          <Row label={t('ops.license.modules')} value={l.modules.join(', ') || '—'} />
          <Row label={t('ops.license.expires')} value={l.expiresAt ? <bdi>{l.expiresAt.slice(0, 10)}</bdi> : t('ops.license.noExpiry')} />
          <Row label={t('ops.license.trial')} value={l.trial ? t('common.yes') : t('common.no')} />
        </Section>
      ) : null}
      {permissions.has('license.create') ? (
        <Section title={t('ops.license.install')}>
          <textarea
            aria-label={t('ops.license.install')}
            className="h-32 w-full rounded-md border border-surface-line bg-surface p-2 font-mono text-[12px]"
            placeholder={t('ops.license.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={() => install.mutate(text.trim(), { onSuccess: () => setText('') })} disabled={!text.trim() || install.isPending}>
              {t('ops.license.installButton')}
            </Button>
            {install.isSuccess ? <span>{t('ops.license.installed')}</span> : null}
            {install.isError ? <span role="alert">{errorText(install.error, t)}</span> : null}
          </div>
        </Section>
      ) : null}
    </Page>
  );
}
