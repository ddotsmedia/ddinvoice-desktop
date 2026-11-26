import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import en from './locales/en.json';
import type { Locale } from '../../shared/ipc';

export const resources = { en: { translation: en }, ar: { translation: ar } } as const;

export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** RTL is driven by the dir attribute on the root element only. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
}

export async function initI18n(locale: Locale = 'en'): Promise<typeof i18next> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources,
      lng: locale,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  }
  applyLocale(locale);
  return i18next;
}

export async function setLocale(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale);
  applyLocale(locale);
}
