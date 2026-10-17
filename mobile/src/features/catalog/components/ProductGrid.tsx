import { FlashList } from '@shopify/flash-list';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, ErrorState, gridColumns, Skeleton } from '@/ui';

import { useCategoryTint } from '../navigation';
import type { ProductCard as Card } from '../types';
import { ProductCard } from './ProductCard';

type Props = {
  products: Card[];
  columns?: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  header?: ReactElement;
};

/**
 * Infinite product grid (FlashList) with skeleton, empty and error states. Columns follow the
 * grid's own width (2 on phones … 6 on desktop) unless `columns` is given.
 */
export function ProductGrid({
  products,
  columns: fixedColumns,
  loading,
  error,
  onRetry,
  onEndReached,
  loadingMore,
  refreshing,
  onRefresh,
  header,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tint = useCategoryTint();
  const [width, setWidth] = useState(0);
  const columns = fixedColumns ?? (width ? gridColumns(width) : 2);
  const onLayout = (w: number) => {
    if (Math.abs(w - width) > 1) setWidth(w);
  };

  if (loading) {
    return (
      <View
        onLayout={(e) => onLayout(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ width: `${100 / columns - 3}%` }}>
            <Skeleton width="100%" height={230} />
          </View>
        ))}
      </View>
    );
  }
  if (error && products.length === 0) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      <FlashList
        key={columns}
        data={products}
        numColumns={columns}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <View style={{ flex: 1, padding: spacing.xs }}>
            <ProductCard product={item} tint={tint(item.category_id)} />
          </View>
        )}
        contentContainerStyle={{ padding: spacing.xs, paddingBottom: spacing.xl }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        refreshing={refreshing}
        onRefresh={onRefresh}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="basket-outline"
            title={t('catalog.noProducts')}
            message={t('catalog.noProductsMessage')}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} />
          ) : null
        }
      />
    </View>
  );
}
