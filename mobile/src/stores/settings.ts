import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import i18n, { deviceLanguage, type Lang } from '@/i18n';
import { kv } from '@/lib/kv';

import type { HeaderThemeKey } from '@/features/catalog/types';

export type ThemePref = 'system' | 'light' | 'dark';
export type TextScale = 1 | 1.2;

type SettingsState = {
  language: Lang;
  theme: ThemePref;
  textScale: TextScale;
  headerTheme: HeaderThemeKey;
  hasChosenLanguage: boolean; // language onboarding (shown once)
  setLanguage: (l: Lang) => void;
  setTheme: (t: ThemePref) => void;
  setHeaderTheme: (t: HeaderThemeKey) => void;
  setLargeText: (on: boolean) => void;
  completeLanguageOnboarding: () => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      theme: 'system',
      textScale: 1,
      headerTheme: 'emerald',
      hasChosenLanguage: false,
      setLanguage: (language) => {
        void i18n.changeLanguage(language);
        set({ language });
      },
      setTheme: (theme) => set({ theme }),
      setHeaderTheme: (headerTheme) => set({ headerTheme }),
      setLargeText: (on) => set({ textScale: on ? 1.2 : 1 }),
      completeLanguageOnboarding: () => set({ hasChosenLanguage: true }),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ language, theme, textScale, headerTheme, hasChosenLanguage }) => ({
        language,
        theme,
        textScale,
        headerTheme,
        hasChosenLanguage,
      }),
    },
  ),
);
