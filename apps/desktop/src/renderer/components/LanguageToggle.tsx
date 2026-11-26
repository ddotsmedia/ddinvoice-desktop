import { useTranslation } from 'react-i18next';
import { Button } from '@ddinvoice/ui';
import { setLocale } from '../i18n';
import { useSession } from '../lib/session';
import type { Locale } from '../../shared/ipc';

/** Switches EN/AR, updates dir/lang on the root element and persists the choice in the main-process config. */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const { updateConfig } = useSession();
  const next: Locale = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <Button
      variant="ghost"
      aria-label={t('topbar.language')}
      onClick={async () => {
        await setLocale(next);
        await updateConfig({ locale: next });
      }}
    >
      {next === 'ar' ? 'العربية' : 'English'}
    </Button>
  );
}
