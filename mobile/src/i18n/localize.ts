import { useSettings } from '@/stores/settings';

import type { Lang } from './index';

export type LocalizedString = Partial<Record<Lang, string | null>>;

const pick = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

/** current language → English → first non-empty value → '' */
export function localize(value: LocalizedString | null | undefined, lang: Lang): string {
  if (!value || typeof value !== 'object') return '';
  return (
    pick(value[lang]) ??
    pick(value.en) ??
    Object.values(value)
      .map(pick)
      .find((v): v is string => Boolean(v)) ??
    ''
  );
}

/** Narrow a Supabase `Json` value ({en,mr,hi} jsonb) without trusting it blindly. */
export function asLocalized(v: unknown): LocalizedString {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  return { en: pick(o.en), mr: pick(o.mr), hi: pick(o.hi) };
}

export function useLocalize() {
  const lang = useSettings((s) => s.language);
  return (v: LocalizedString | null | undefined) => localize(v, lang);
}
