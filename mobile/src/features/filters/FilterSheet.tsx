import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { spacing } from '@/theme/tokens';
import { Button, Chip, Sheet, Text } from '@/ui';

import type { AttributeField } from '../catalog/types';
import {
  attributeFilterField,
  isAttrSelected,
  isPriceSelected,
  priceRanges,
  setPrice,
  toggleAttr,
  toggleBrand,
  toggleFlag,
  type FilterConfig,
  type FilterOptions,
  type Filters,
  type PriceRange,
} from './filters';

export function usePriceLabel() {
  const { t } = useTranslation();
  return (r: PriceRange) =>
    r.max === undefined
      ? t('filters.priceAbove', { price: formatPrice(r.min) })
      : r.min === 0
        ? t('filters.priceUnder', { price: formatPrice(r.max) })
        : t('filters.priceBetween', { min: formatPrice(r.min), max: formatPrice(r.max) });
}

type Props = {
  visible: boolean;
  onClose: () => void;
  config: FilterConfig[];
  fields: AttributeField[];
  options?: FilterOptions;
  value: Filters;
  onApply: (f: Filters) => void;
  tint?: string | null;
};

/** Filters defined per category by the admin (categories.filters); edits a draft, applied on "Apply". */
export function FilterSheet(props: Props) {
  const { t } = useTranslation();
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={t('filters.title')}>
      {/* Mounted only while open, so the draft starts from the applied filters every time. */}
      {props.visible ? <FilterSheetBody {...props} /> : null}
    </Sheet>
  );
}

function FilterSheetBody({ onClose, config, fields, options, value, onApply, tint }: Props) {
  const { t } = useTranslation();
  const l = useLocalize();
  const priceLabel = usePriceLabel();
  const [draft, setDraft] = useState<Filters>(value);

  const chipTint = tint ?? undefined;
  const sections = config.map((c, i) => {
    switch (c.type) {
      case 'brand': {
        const brands = options?.brands ?? [];
        if (brands.length === 0) return null;
        return (
          <Section key={`b${i}`} title={t('filters.brand')}>
            {brands.map((b) => (
              <Chip
                key={b.id}
                tint={chipTint}
                label={`${l(b.name)} (${b.count})`}
                selected={draft.brand_ids?.includes(b.id)}
                onPress={() => setDraft((d) => toggleBrand(d, b.id))}
              />
            ))}
          </Section>
        );
      }
      case 'price':
        return (
          <Section key={`p${i}`} title={t('filters.price')}>
            {priceRanges(c.buckets).map((r) => (
              <Chip
                key={`${r.min}-${r.max ?? ''}`}
                tint={chipTint}
                label={priceLabel(r)}
                selected={isPriceSelected(draft, r)}
                onPress={() => setDraft((d) => setPrice(d, r))}
              />
            ))}
          </Section>
        );
      case 'veg':
        return (
          <Section key={`v${i}`} title={t('filters.diet')}>
            <Chip
              tint={chipTint}
              icon="leaf"
              label={t('filters.vegOnly')}
              selected={!!draft.veg}
              onPress={() => setDraft((d) => toggleFlag(d, 'veg'))}
            />
          </Section>
        );
      case 'in_stock':
        return null; // always shown below
      case 'attribute': {
        const f = attributeFilterField(fields, c.key);
        if (!f) return null;
        if (f.type === 'boolean') {
          return (
            <Section key={`a${i}`} title={l(f.label)}>
              <Chip
                tint={chipTint}
                label={l(f.label)}
                selected={isAttrSelected(draft, f.key, true)}
                onPress={() => setDraft((d) => toggleAttr(d, f.key, true))}
              />
            </Section>
          );
        }
        const counts = new Map((options?.attributes[f.key] ?? []).map((x) => [x.value, x.count]));
        const opts = (f.options ?? []).filter((o) => !options || (counts.get(o.value) ?? 0) > 0);
        if (opts.length === 0) return null;
        return (
          <Section key={`a${i}`} title={l(f.label)}>
            {opts.map((o) => (
              <Chip
                key={o.value}
                tint={chipTint}
                label={counts.has(o.value) ? `${l(o.label)} (${counts.get(o.value)})` : l(o.label)}
                selected={isAttrSelected(draft, f.key, o.value)}
                onPress={() => setDraft((d) => toggleAttr(d, f.key, o.value))}
              />
            ))}
          </Section>
        );
      }
    }
  });

  return (
    <>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.lg }}>
        {sections}
        <Section title={t('filters.availability')}>
          <Chip
            tint={chipTint}
            icon="check-circle-outline"
            label={t('filters.inStock')}
            selected={!!draft.in_stock}
            onPress={() => setDraft((d) => toggleFlag(d, 'in_stock'))}
          />
        </Section>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button
            title={t('filters.clearAll')}
            variant="secondary"
            fullWidth
            onPress={() => setDraft({})}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={t('filters.apply')}
            fullWidth
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          />
        </View>
      </View>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text weight="semibold">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>
    </View>
  );
}
