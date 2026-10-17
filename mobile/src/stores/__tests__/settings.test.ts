import i18n, { initI18n } from '@/i18n';
import { kv } from '@/lib/kv';

import { useSettings } from '../settings';

initI18n('en');

describe('settings store', () => {
  it('changes language in i18n and persists it', () => {
    useSettings.getState().setLanguage('mr');
    expect(i18n.language).toBe('mr');
    expect(JSON.parse(kv.getString('settings') ?? '{}').state.language).toBe('mr');
  });

  it('toggles large text', () => {
    useSettings.getState().setLargeText(true);
    expect(useSettings.getState().textScale).toBe(1.2);
    useSettings.getState().setLargeText(false);
    expect(useSettings.getState().textScale).toBe(1);
  });

  it('persists theme and onboarding', () => {
    useSettings.getState().setTheme('dark');
    useSettings.getState().completeLanguageOnboarding();
    const saved = JSON.parse(kv.getString('settings') ?? '{}').state;
    expect(saved).toMatchObject({ theme: 'dark', hasChosenLanguage: true });
  });
});
