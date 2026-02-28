import { en } from './locales/en';
import { ru } from './locales/ru';

export type Locale = 'en' | 'ru';

export type TranslationKeys = keyof typeof en;

const translations: Record<Locale, Record<string, string>> = {
  en,
  ru,
};

let currentLocale: Locale = 'en';

/**
 * Set the current locale
 */
export function setLocale(locale: Locale): void {
  if (translations[locale]) {
    currentLocale = locale;
    localStorage.setItem('lumie_locale', locale);
  }
}

/**
 * Get the current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Initialize locale from localStorage or browser settings
 */
export function initLocale(): Locale {
  const saved = localStorage.getItem('lumie_locale') as Locale | null;
  if (saved && translations[saved]) {
    currentLocale = saved;
    return currentLocale;
  }

  // Detect from browser
  const browserLang = navigator.language.split('-')[0];
  if (browserLang === 'ru') {
    currentLocale = 'ru';
  } else {
    currentLocale = 'en';
  }

  return currentLocale;
}

/**
 * Translate a key
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[currentLocale][key] || translations.en[key] || key;

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    });
  }

  return text;
}

/**
 * React hook for translations
 */
export function useTranslation() {
  return {
    t,
    locale: currentLocale,
    setLocale,
  };
}

export { en, ru };
