import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { catalogImageUrl } from '@/lib/images';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  Text,
  TextField,
} from '@/ui';

import type { AdminProductListItem, CategoryRow } from './api';
import { AdminShell, ChoiceRow, useWide } from './components';
import { fieldsOf, useAdminCategories, useAdminProducts } from './hooks';
import { effectiveAdminFields } from './schema';

const editHref = (q: string) => `/admin/products/edit?${q}` as Href;

/** Required, non-deprecated attribute keys a product of this category is missing. */
export function missingRequired(p: AdminProductListItem, cats: CategoryRow[]): string[] {
  const cat = cats.find((c) => c.id === p.category_id);
  const parent = cat?.parent_id ? cats.find((c) => c.id === cat.parent_id) : undefined;
  const attrs = (p.attributes ?? {}) as Record<string, unknown>;
  return effectiveAdminFields(fieldsOf(parent), fieldsOf(cat))
    .filter((f) => f.required && !f.deprecated)
    .filter((f) => attrs[f.key] === undefined || attrs[f.key] === null || attrs[f.key] === '')
    .map((f) => f.key);
}

export function ProductsAdminScreen() {
  const { t } = useTranslation();
  const l = useLocalize();
  const { colors } = useTheme();
  const wide = useWide();
  const cats = useAdminCategories();
  const [q, setQ] = useState('');
  const [parentId, setParentId] = useState<number | null>(null);
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const categoryIds = useMemo(() => {
    if (!parentId || !cats.data) return null;
    return cats.data.filter((c) => c.parent_id === parentId).map((c) => c.id);
  }, [parentId, cats.data]);

  const products = useAdminProducts(q, categoryIds, status);
  const items = (products.data?.pages ?? []).flat();
  const rows =
    onlyMissing && cats.data
      ? items.filter((p) => missingRequired(p, cats.data).length > 0)
      : items;
  const catName = (id: number) => l(asLocalized(cats.data?.find((c) => c.id === id)?.name));

  return (
    <AdminShell
      title={t('admin.nav.products')}
      subtitle={t('admin.ui.productsSubtitle')}
      actions={
        wide ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Button
              title={t('admin.prod.import')}
              icon="file-delimited-outline"
              variant="secondary"
              onPress={() => router.push('/admin/products/import' as Href)}
            />
            <Button
              title={t('admin.prod.new')}
              icon="plus"
              onPress={() => router.push(editHref('new=1'))}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton
              icon="file-delimited-outline"
              accessibilityLabel={t('admin.prod.import')}
              onPress={() => router.push('/admin/products/import' as Href)}
            />
            <IconButton
              icon="plus"
              accessibilityLabel={t('admin.prod.new')}
              onPress={() => router.push(editHref('new=1'))}
            />
          </View>
        )
      }
    >
      {!wide ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title={t('admin.prod.new')}
              icon="plus"
              fullWidth
              onPress={() => router.push(editHref('new=1'))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={t('admin.prod.import')}
              icon="file-delimited-outline"
              variant="secondary"
              fullWidth
              onPress={() => router.push('/admin/products/import' as Href)}
            />
          </View>
        </View>
      ) : null}
      <TextField
        label={t('admin.prod.search')}
        value={q}
        onChangeText={setQ}
        placeholder={t('admin.prod.searchPh')}
        autoCapitalize="none"
      />
      <ChoiceRow
        label={t('admin.prod.category')}
        value={parentId}
        onChange={setParentId}
        options={[
          { value: null, label: t('admin.all') },
          ...(cats.data ?? [])
            .filter((c) => c.parent_id === null)
            .map((c) => ({ value: c.id as number | null, label: l(asLocalized(c.name)) })),
        ]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {(['all', 'active', 'inactive'] as const).map((s) => (
          <Chip
            key={s}
            label={t(`admin.prod.status_${s}`)}
            selected={status === s}
            onPress={() => setStatus(s)}
          />
        ))}
        <Chip
          label={t('admin.prod.onlyMissing')}
          icon="alert-outline"
          selected={onlyMissing}
          onPress={() => setOnlyMissing((v) => !v)}
        />
      </View>

      {products.isPending ? (
        <Skeleton width="100%" height={300} />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="package-variant" title={t('admin.prod.none')} />
      ) : (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.surfaceAlt,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              variant="caption"
              weight="bold"
              color="textMuted"
              style={{ flex: 1, textTransform: 'uppercase' }}
            >
              {t('admin.ui.colProduct')} ({rows.length})
            </Text>
            <Text
              variant="caption"
              weight="bold"
              color="textMuted"
              style={{ textTransform: 'uppercase' }}
            >
              {t('admin.ui.colStatus')}
            </Text>
          </View>
          {rows.map((p, idx) => {
            const def = p.product_variants.find((v) => v.is_default) ?? p.product_variants[0];
            const thumb = [...p.product_images].sort((a, b) => a.sort_order - b.sort_order)[0]
              ?.thumb_path;
            const missing = cats.data ? missingRequired(p, cats.data) : [];
            const url = catalogImageUrl(thumb);
            return (
              <View
                key={p.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  backgroundColor: idx % 2 ? colors.background : colors.surface,
                }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radius.sm,
                    backgroundColor: colors.surfaceAlt,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {url ? (
                    <Image
                      source={{ uri: url }}
                      style={{ width: 48, height: 48 }}
                      contentFit="cover"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="image-off-outline"
                      size={20}
                      color={colors.textMuted}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text weight="semibold" numberOfLines={1}>
                    {l(asLocalized(p.name))}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {catName(p.category_id)} · {p.product_variants.length}{' '}
                    {t('admin.prod.variants')}
                    {def ? ` · ${formatPrice(def.price)} / ${formatPrice(def.mrp)}` : ''}
                  </Text>
                </View>
                {!p.is_active ? <Badge label={t('admin.hidden')} tone="warning" /> : null}
                {missing.length ? (
                  <Badge
                    label={t('admin.prod.missingN', { count: missing.length })}
                    tone="danger"
                  />
                ) : null}
                {!thumb ? <Badge label={t('admin.prod.noPhoto')} tone="neutral" /> : null}
                <Button
                  title={t('admin.edit')}
                  icon="pencil-outline"
                  variant="ghost"
                  onPress={() => router.push(editHref(`id=${p.id}`))}
                />
              </View>
            );
          })}
        </View>
      )}
      {products.hasNextPage ? (
        <Button
          title={t('admin.loadMore')}
          variant="secondary"
          loading={products.isFetchingNextPage}
          onPress={() => void products.fetchNextPage()}
        />
      ) : null}
    </AdminShell>
  );
}
