import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, Input } from '@ddinvoice/ui';
import type { DiscoveredServer, InstallServerResult, ProbeResult } from '../../../shared/ipc';
import { setLocale } from '../../i18n';
import { ApiError } from '../../lib/api';

/** Local server origin the Main PC pairs with after installation (CLI default port). */
const LOCAL_ORIGIN = 'https://localhost:47820';
const EMIRATES = ['ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH'] as const;

type Step = 'language' | 'role' | 'install' | 'discover' | 'pair';

const installSchema = z.object({
  companyNameEn: z.string().min(1, { error: 'validation.required' }).max(200),
  companyNameAr: z.string().min(1, { error: 'validation.required' }).max(200),
  trn: z.string().regex(/^\d{15}$/, { error: 'validation.trn' }),
  emirate: z.enum(EMIRATES),
  adminEmail: z.email({ error: 'validation.invalidEmail' }),
  adminPassword: z.string().min(12, { error: 'validation.min' }),
});
type InstallValues = z.infer<typeof installSchema>;

const pairSchema = z.object({
  code: z.string().regex(/^\d{6}$/, { error: 'validation.pairingCode' }),
  deviceName: z.string().min(1, { error: 'validation.required' }).max(100),
});
type PairValues = z.infer<typeof pairSchema>;

/** Setup wizard: 1 language, 2 role, 3a server install (Main PC) or 3b discovery (Workstation), pairing, then sign-in. */
export function SetupWizard() {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('language');
  const [role, setRole] = useState<'main' | 'workstation' | null>(null);
  const [installed, setInstalled] = useState<InstallServerResult | null>(null);
  const [target, setTarget] = useState<{ origin: string; probe: ProbeResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setError(e instanceof ApiError ? t(e.messageKey) : e instanceof Error ? e.message : t('errors.generic'));

  const pickLocale = async (locale: 'en' | 'ar') => {
    await setLocale(locale);
    await window.ddi.config.set({ locale });
    setStep('role');
  };

  /** Probes the server certificate; the user must confirm it matches the server screen before pairing. */
  const probe = async (origin: string) => {
    setError(null);
    setBusy(true);
    try {
      const probe = await window.ddi.server.probe({ origin });
      setTarget({ origin, probe });
      setStep('pair');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const pair = async (values: PairValues) => {
    if (!target) return;
    setError(null);
    setBusy(true);
    try {
      await window.ddi.server.pair({
        origin: target.origin,
        code: values.code,
        caPem: target.probe.caPem,
        caFingerprint: target.probe.caFingerprint,
        deviceName: values.deviceName,
      });
      await window.ddi.config.set({ role: role ?? 'workstation', setupDone: true });
      window.location.reload();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-[460px] max-w-full rounded-lg border border-surface-line bg-surface p-5">
        <h1 className="text-[18px] font-semibold text-navy">{t('setup.title')}</h1>
        <ol className="mb-4 mt-1 flex gap-2 text-[12px] text-navy-muted" aria-label="steps">
          {(['language', 'role', 'server', 'pair', 'login'] as const).map((s, i) => (
            <li key={s} className={i <= ['language', 'role', 'install', 'pair'].indexOf(step === 'discover' ? 'install' : step) ? 'text-cobalt' : ''}>
              {i + 1}. {t(`setup.steps.${s}`)}
            </li>
          ))}
        </ol>

        {error ? (
          <p role="alert" className="mb-3 rounded border border-red-100 bg-red-50 px-2 py-1 text-red-700">
            {error}
          </p>
        ) : null}

        {step === 'language' ? (
          <section className="space-y-3">
            <h2 className="text-navy-muted">{t('setup.languageTitle')}</h2>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void pickLocale('en')} aria-pressed={i18n.language === 'en'}>
                {t('languages.en')}
              </Button>
              <Button variant="secondary" onClick={() => void pickLocale('ar')} aria-pressed={i18n.language === 'ar'}>
                {t('languages.ar')}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 'role' ? (
          <section className="space-y-2">
            <h2 className="text-navy-muted">{t('setup.roleTitle')}</h2>
            {(
              [
                ['main', 'setup.roleMain', 'setup.roleMainHint'],
                ['workstation', 'setup.roleWorkstation', 'setup.roleWorkstationHint'],
              ] as const
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                className="block w-full rounded-md border border-surface-line p-3 text-start hover:border-cobalt"
                onClick={() => {
                  setRole(value);
                  setStep(value === 'main' ? 'install' : 'discover');
                }}
              >
                <span className="block font-medium text-navy">{t(title)}</span>
                <span className="block text-navy-muted">{t(hint)}</span>
              </button>
            ))}
            <Button variant="ghost" onClick={() => setStep('language')}>
              {t('common.back')}
            </Button>
          </section>
        ) : null}

        {step === 'install' ? (
          installed ? (
            <section className="space-y-3">
              <h2 className="font-medium text-navy">{t('setup.pairingCodeTitle')}</h2>
              <p className="text-2xl font-semibold tracking-widest text-navy">
                <bdi dir="ltr">{installed.pairingCode}</bdi>
              </p>
              <p className="text-navy-muted">{t('setup.pairingCodeHint')}</p>
              <p className="text-navy-muted">{t('setup.caFingerprint')}</p>
              <p className="break-all text-[12px]">
                <bdi dir="ltr">{installed.caFingerprint}</bdi>
              </p>
              <Button variant="primary" disabled={busy} onClick={() => void probe(LOCAL_ORIGIN)}>
                {t('setup.pair')}
              </Button>
            </section>
          ) : (
            <InstallForm
              busy={busy}
              onSubmit={async (values) => {
                setError(null);
                setBusy(true);
                try {
                  setInstalled(await window.ddi.setup.installServer(values));
                } catch (e) {
                  fail(e);
                } finally {
                  setBusy(false);
                }
              }}
            />
          )
        ) : null}

        {step === 'discover' ? <Discover busy={busy} onProbe={probe} /> : null}

        {step === 'pair' && target ? (
          <PairForm
            probe={target.probe}
            origin={target.origin}
            busy={busy}
            onSubmit={pair}
          />
        ) : null}
      </div>
    </div>
  );
}

function InstallForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: InstallValues) => Promise<void> }) {
  const { t } = useTranslation();
  const { register, handleSubmit, formState } = useForm<InstallValues>({
    resolver: zodResolver(installSchema),
    defaultValues: { companyNameEn: '', companyNameAr: '', trn: '', emirate: 'DUBAI', adminEmail: '', adminPassword: '' },
  });
  const err = (k: keyof InstallValues) =>
    formState.errors[k] ? <span className="text-[12px] text-red-700">{t(formState.errors[k]?.message ?? 'validation.required')}</span> : null;
  return (
    <form className="space-y-2" onSubmit={handleSubmit(onSubmit)} noValidate>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.companyNameEn')}</span>
        <Input dir="ltr" {...register('companyNameEn')} />
        {err('companyNameEn')}
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.companyNameAr')}</span>
        <Input {...register('companyNameAr')} />
        {err('companyNameAr')}
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.trn')}</span>
        <Input dir="ltr" inputMode="numeric" {...register('trn')} />
        {err('trn')}
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.emirate')}</span>
        <select className="h-7 w-full rounded-md border border-surface-line bg-surface px-2" {...register('emirate')}>
          {EMIRATES.map((e) => (
            <option key={e} value={e}>
              {t(`emirates.${e.toLowerCase()}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.adminEmail')}</span>
        <Input dir="ltr" type="email" {...register('adminEmail')} />
        {err('adminEmail')}
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.adminPassword')}</span>
        <Input dir="ltr" type="password" autoComplete="new-password" {...register('adminPassword')} />
        {err('adminPassword')}
      </label>
      <Button variant="primary" type="submit" disabled={busy}>
        {busy ? t('setup.installing') : t('setup.installServer')}
      </Button>
    </form>
  );
}

function Discover({ busy, onProbe }: { busy: boolean; onProbe: (origin: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<DiscoveredServer[] | null>(null);
  const [manual, setManual] = useState('');
  const [searching, setSearching] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    try {
      setServers(await window.ddi.server.discover());
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="space-y-3">
      <Button variant="secondary" onClick={() => void search()} disabled={searching}>
        {searching ? t('setup.discovering') : t('setup.discover')}
      </Button>
      {servers !== null ? (
        servers.length > 0 ? (
          <div>
            <p className="text-navy-muted">{t('setup.discovered')}</p>
            <ul className="mt-1 space-y-1">
              {servers.map((s) => (
                <li key={s.origin}>
                  <button type="button" className="w-full rounded-md border border-surface-line px-2 py-1.5 text-start hover:border-cobalt" disabled={busy} onClick={() => void onProbe(s.origin)}>
                    <bdi dir="ltr">{s.origin}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-navy-muted">{t('setup.noneFound')}</p>
        )
      ) : null}
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.manualAddress')}</span>
        <Input dir="ltr" placeholder={t('setup.manualAddressHint')} value={manual} onChange={(e) => setManual(e.target.value)} aria-invalid={!!manualError} />
        {manualError ? <span className="text-[12px] text-red-700">{manualError}</span> : null}
      </label>
      <Button
        variant="primary"
        disabled={busy || manual.trim() === ''}
        onClick={() => {
          try {
            const u = new URL(manual.trim());
            if (u.protocol !== 'https:') throw new Error('https');
            setManualError(null);
            void onProbe(u.origin);
          } catch {
            setManualError(t('validation.url'));
          }
        }}
      >
        {t('common.next')}
      </Button>
    </section>
  );
}

function PairForm({ probe, origin, busy, onSubmit }: { probe: ProbeResult; origin: string; busy: boolean; onSubmit: (v: PairValues) => Promise<void> }) {
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState(false);
  const { register, handleSubmit, formState } = useForm<PairValues>({
    resolver: zodResolver(pairSchema),
    defaultValues: { code: '', deviceName: '' },
  });
  return (
    <form className="space-y-3" onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className="text-navy-muted">
        <bdi dir="ltr">{origin}</bdi>
      </p>
      <p className="text-navy-muted">{t('setup.confirmFingerprint')}</p>
      <p className="break-all rounded bg-surface-muted p-2 text-[12px]">
        <bdi dir="ltr">{probe.caFingerprint}</bdi>
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{t('setup.fingerprintMatches')}</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.pairingCode')}</span>
        <Input dir="ltr" inputMode="numeric" maxLength={6} aria-invalid={!!formState.errors.code} {...register('code')} />
        {formState.errors.code ? <span className="text-[12px] text-red-700">{t(formState.errors.code.message ?? 'validation.pairingCode')}</span> : null}
      </label>
      <label className="block">
        <span className="mb-1 block text-navy-muted">{t('setup.deviceName')}</span>
        <Input {...register('deviceName')} />
        {formState.errors.deviceName ? <span className="text-[12px] text-red-700">{t(formState.errors.deviceName.message ?? 'validation.required')}</span> : null}
      </label>
      <Button variant="primary" type="submit" disabled={busy || !confirmed}>
        {t('setup.pair')}
      </Button>
    </form>
  );
}
