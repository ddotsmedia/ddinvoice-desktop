import { useTranslation } from 'react-i18next';

export function Loading() {
  const { t } = useTranslation();
  return <div className="flex h-full items-center justify-center text-navy-muted">{t('common.loading')}</div>;
}
