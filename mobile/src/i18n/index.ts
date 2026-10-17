import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';

export const LANGUAGES = [
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi' },
  { code: 'en', native: 'English', english: 'English' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'mr' || v === 'hi';

export function deviceLanguage(): Lang {
  const code = getLocales()[0]?.languageCode;
  return isLang(code) ? code : 'en';
}

export function initI18n(lang: Lang) {
  if (i18n.isInitialized) {
    // eslint-disable-next-line import/no-named-as-default-member
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
    return i18n;
  }
  // eslint-disable-next-line import/no-named-as-default-member
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, mr: { translation: mr }, hi: { translation: hi } },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false, // resources are bundled: initialise synchronously so the first frame is translated
  });
  return i18n;
}

export default i18n;
