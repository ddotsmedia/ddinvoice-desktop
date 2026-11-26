import { useTranslation } from 'react-i18next';

/** Blocking screen when this client is newer than the paired server (update the main PC first). */
export function ServerNeedsUpdate({ current, server }: { current: string; server: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-surface-line bg-surface p-6">
        <h1 className="text-[18px] font-semibold text-navy">{t('serverNeedsUpdate.title')}</h1>
        <p className="mt-2 text-navy-muted">{t('serverNeedsUpdate.body')}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          <dt className="text-navy-muted">{t('updateRequired.current')}</dt>
          <dd><bdi dir="ltr">{current}</bdi></dd>
          <dt className="text-navy-muted">{t('updateRequired.required')}</dt>
          <dd><bdi dir="ltr">{server}</bdi></dd>
        </dl>
      </div>
    </div>
  );
}
