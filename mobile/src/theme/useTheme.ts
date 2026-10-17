import { useColorScheme } from 'react-native';

import { useSettings } from '@/stores/settings';

import { palette, type Colors, type Scheme } from './tokens';

export function resolveScheme(
  pref: 'system' | 'light' | 'dark',
  system: string | null | undefined,
): Scheme {
  if (pref !== 'system') return pref;
  return system === 'dark' ? 'dark' : 'light';
}

export function useTheme(): { scheme: Scheme; colors: Colors; isDark: boolean; textScale: number } {
  const pref = useSettings((s) => s.theme);
  const textScale = useSettings((s) => s.textScale);
  const system = useColorScheme();
  const scheme = resolveScheme(pref, system);
  return { scheme, colors: palette[scheme], isDark: scheme === 'dark', textScale };
}
