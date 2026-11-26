import { useTranslation } from 'react-i18next';

export function ComingSoon() {
  const { t } = useTranslation();
  return (
    <div className="p-6">
      <p className="text-navy-muted">{t('common.comingSoon')}</p>
    </div>
  );
}
