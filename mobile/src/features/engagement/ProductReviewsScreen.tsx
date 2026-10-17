import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useLocalize } from '@/i18n/localize';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Card, EmptyState, ErrorState, ScreenHeader, Skeleton, Text } from '@/ui';

import { Stars } from './components';
import { useProductRating, useProductReviews } from './hooks';
import { ReviewRow } from './ReviewsPreview';

export function ProductReviewsScreen({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const rating = useProductRating(slug);
  const product = rating.data;
  const q = useProductReviews(product?.id);
  const items = q.data?.pages.flat() ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={t('reviews.title')} subtitle={product ? l(product.name) : undefined} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {rating.isPending || (product && q.isPending) ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="60%" height={28} />
            <Skeleton width="100%" height={72} />
            <Skeleton width="100%" height={72} />
          </View>
        ) : rating.isError || q.isError ? (
          <ErrorState
            error={rating.error ?? q.error}
            onRetry={() => void Promise.all([rating.refetch(), q.refetch()])}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(r) => r.user_id}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
            ListHeaderComponent={
              product && product.rating_count > 0 ? (
                <Card style={{ alignItems: 'center', gap: spacing.xs }}>
                  <Text variant="h1">{product.rating_avg.toFixed(1)}</Text>
                  <Stars value={product.rating_avg} size={20} />
                  <Text color="textMuted">
                    {t('reviews.count', { count: product.rating_count })}
                  </Text>
                  <Text variant="caption" color="textMuted" align="center">
                    {t('reviews.onlyBuyers')}
                  </Text>
                </Card>
              ) : undefined
            }
            ListEmptyComponent={
              <EmptyState
                icon="star-outline"
                title={t('reviews.emptyTitle')}
                message={t('reviews.emptyBody')}
              />
            }
            renderItem={({ item }) => (
              <Card>
                <ReviewRow review={item} />
              </Card>
            )}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
