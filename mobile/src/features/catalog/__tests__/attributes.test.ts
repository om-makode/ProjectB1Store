import type { TFunction } from 'i18next';

import { localize } from '@/i18n/localize';

import { effectiveFields, formatAttribute } from '../attributes';
import type { AttributeField } from '../types';

const l = (v: Parameters<typeof localize>[0]) => localize(v, 'mr');
const t = ((k: string) => (k === 'catalog.yes' ? 'हो' : k)) as unknown as TFunction;

const milkType: AttributeField = {
  key: 'milk_type',
  type: 'select',
  label: { en: 'Milk type' },
  options: [{ value: 'buffalo', label: { en: 'Buffalo', mr: 'म्हैस' } }],
};

describe('attribute display registry', () => {
  it('child fields override parent fields; deprecated ones are hidden', () => {
    const fields = effectiveFields([
      { key: 'a', type: 'text', label: { en: 'Parent' } },
      { key: 'a', type: 'text', label: { en: 'Child' } },
      { key: 'old', type: 'text', label: { en: 'Old' }, deprecated: true },
    ]);
    expect(fields.map((f) => f.label.en)).toEqual(['Child']);
  });

  it('formats select, number, boolean in the chosen language', () => {
    expect(formatAttribute(milkType, 'buffalo', l, t)).toBe('म्हैस');
    expect(formatAttribute({ key: 'fat', type: 'number', unit: '%', label: {} }, 3, l, t)).toBe(
      '3 %',
    );
    expect(formatAttribute({ key: 'org', type: 'boolean', label: {} }, true, l, t)).toBe('हो');
    expect(formatAttribute({ key: 'org', type: 'boolean', label: {} }, false, l, t)).toBe('');
  });
});
