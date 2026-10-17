import type { TFunction } from 'i18next';

import { asLocalized, type LocalizedString } from '@/i18n/localize';

import type { AttributeField } from './types';

/**
 * Display registry for admin-defined attributes (the no-code engine).
 * Parent fields come first, then sub-category fields; a child field with the same key wins.
 * Deprecated fields are hidden.
 */
export function effectiveFields(fields: AttributeField[] | null | undefined): AttributeField[] {
  const byKey = new Map<string, AttributeField>();
  for (const f of fields ?? []) byKey.set(f.key, f);
  return [...byKey.values()].filter((f) => !f.deprecated);
}

type Localize = (v: LocalizedString | null | undefined) => string;

const optionLabel = (f: AttributeField, value: unknown, l: Localize) => {
  const o = f.options?.find((x) => x.value === value);
  return o ? l(o.label) : String(value);
};

/** Human text for one attribute value, or '' when there's nothing worth showing. */
export function formatAttribute(
  f: AttributeField,
  value: unknown,
  l: Localize,
  t: TFunction,
): string {
  if (value === null || value === undefined || value === '') return '';
  switch (f.type) {
    case 'boolean':
      return value === true ? t('catalog.yes') : ''; // like Blinkit: only show what's true
    case 'number':
      return typeof value === 'number' || typeof value === 'string'
        ? `${value}${f.unit ? ` ${f.unit}` : ''}`
        : '';
    case 'select':
      return optionLabel(f, value, l);
    case 'multiSelect':
      return Array.isArray(value) ? value.map((v) => optionLabel(f, v, l)).join(', ') : '';
    case 'localizedText':
      return l(asLocalized(value));
    case 'localizedList':
      return Array.isArray(value)
        ? value
            .map((v) => l(asLocalized(v)))
            .filter(Boolean)
            .join(', ')
        : '';
    case 'date':
    case 'text':
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}
