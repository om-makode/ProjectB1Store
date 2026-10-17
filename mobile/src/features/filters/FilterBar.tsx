import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLocalize } from '@/i18n/localize';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Chip } from '@/ui';

import type { AttributeField } from '../catalog/types';
import {
  activeCount,
  attributeFilterField,
  isAttrSelected,
  setPrice,
  toggleAttr,
  toggleBrand,
  toggleFlag,
  type FilterConfig,
  type FilterOptions,
  type Filters,
} from './filters';
import { usePriceLabel } from './FilterSheet';

type Props = {
  config: FilterConfig[];
  fields: AttributeField[];
  options?: FilterOptions;
  value: Filters;
  onChange: (f: Filters) => void;
  onOpenSheet: () => void;
  tint?: string | null;
};

/**
 * Sticky chip row: "Filters (n)", one-tap quick filters (veg, admin-marked `quick`),
 * then every active filter as a selected chip (tap to remove), then "Clear".
 */
export function FilterBar({ config, fields, options, value, onChange, onOpenSheet, tint }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const priceLabel = usePriceLabel();
  const n = activeCount(value);
  const chipTint = tint ?? undefined;

  const quick = config.flatMap((c) => {
    if (c.type === 'veg' && c.quick)
      return [
        <Chip
          key="veg"
          tint={chipTint}
          icon="leaf"
          label={t('filters.vegOnly')}
          selected={!!value.veg}
          onPress={() => onChange(toggleFlag(value, 'veg'))}
        />,
      ];
    if (c.type === 'attribute' && c.quick) {
      const f = attributeFilterField(fields, c.key);
      if (f?.type !== 'boolean') return [];
      return [
        <Chip
          key={`q-${f.key}`}
          tint={chipTint}
          label={l(f.label)}
          selected={isAttrSelected(value, f.key, true)}
          onPress={() => onChange(toggleAttr(value, f.key, true))}
        />,
      ];
    }
    return [];
  });
  const quickKeys = new Set(
    config.flatMap((c) => (c.type === 'attribute' && c.quick ? [c.key] : [])),
  );
  const quickVeg = config.some((c) => c.type === 'veg' && c.quick);

  // Active, non-quick filters as removable chips
  const active: React.ReactElement[] = [];
  for (const id of value.brand_ids ?? []) {
    const b = options?.brands.find((x) => x.id === id);
    active.push(
      <Chip
        key={`b-${id}`}
        tint={chipTint}
        icon="close"
        selected
        label={b ? l(b.name) : t('filters.brand')}
        onPress={() => onChange(toggleBrand(value, id))}
      />,
    );
  }
  if (value.price_min !== undefined) {
    active.push(
      <Chip
        key="price"
        tint={chipTint}
        icon="close"
        selected
        label={priceLabel({ min: value.price_min, max: value.price_max })}
        onPress={() => onChange(setPrice(value, null))}
      />,
    );
  }
  if (value.veg && !quickVeg) {
    active.push(
      <Chip
        key="veg-a"
        tint={chipTint}
        icon="close"
        selected
        label={t('filters.vegOnly')}
        onPress={() => onChange(toggleFlag(value, 'veg'))}
      />,
    );
  }
  if (value.in_stock) {
    active.push(
      <Chip
        key="stock"
        tint={chipTint}
        icon="close"
        selected
        label={t('filters.inStock')}
        onPress={() => onChange(toggleFlag(value, 'in_stock'))}
      />,
    );
  }
  for (const [key, v] of Object.entries(value.attrs ?? {})) {
    if (quickKeys.has(key)) continue;
    const f = fields.find((x) => x.key === key);
    const values: (string | true)[] = v === true ? [true] : Array.isArray(v) ? v : [];
    for (const val of values) {
      const label =
        val === true
          ? l(f?.label)
          : l(f?.options?.find((o) => o.value === val)?.label) || String(val);
      active.push(
        <Chip
          key={`a-${key}-${String(val)}`}
          tint={chipTint}
          icon="close"
          selected
          label={label}
          onPress={() => onChange(toggleAttr(value, key, val))}
        />,
      );
    }
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: spacing.sm, gap: spacing.sm }}
      accessibilityLabel={t('filters.title')}
    >
      <Chip
        tint={chipTint}
        icon="tune-variant"
        label={n > 0 ? t('filters.titleCount', { count: n }) : t('filters.title')}
        selected={n > 0}
        onPress={onOpenSheet}
      />
      {quick}
      {active}
      {n > 0 ? <Chip label={t('filters.clear')} onPress={() => onChange({})} /> : null}
    </ScrollView>
  );
}
