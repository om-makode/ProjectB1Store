import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import i18n, { deviceLanguage, type Lang } from '@/i18n';
import { kv } from '@/lib/kv';

export type ThemePref = 'system' | 'light' | 'dark';
export type TextScale = 1 | 1.2;

type SettingsState = {
  language: Lang;
  theme: ThemePref;
  textScale: TextScale;
  hasChosenLanguage: boolean; // language onboarding (shown once)
  setLanguage: (l: Lang) => void;
  setTheme: (t: ThemePref) => void;
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
      hasChosenLanguage: false,
      setLanguage: (language) => {
        void i18n.changeLanguage(language);
        set({ language });
      },
      setTheme: (theme) => set({ theme }),
      setLargeText: (on) => set({ textScale: on ? 1.2 : 1 }),
      completeLanguageOnboarding: () => set({ hasChosenLanguage: true }),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ language, theme, textScale, hasChosenLanguage }) => ({
        language,
        theme,
        textScale,
        hasChosenLanguage,
      }),
    },
  ),
);
