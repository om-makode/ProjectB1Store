import { router } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSettings } from '@/stores/settings';
import { formatDateTime } from '@/lib/format';
import { spacing } from '@/theme/tokens';
import { Button, Card, Text } from '@/ui';

import type { Review } from './api';
import { Stars } from './components';
import { useProductReviews } from './hooks';

/** Top 3 reviews on the product page + "See all". */
export function ReviewsPreview({ productId, slug }: { productId: number; slug: string }) {
  const { t } = useTranslation();
  const q = useProductReviews(productId);
  const items = (q.data?.pages.flat() ?? []).filter((r) => r.comment).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <Card style={{ marginHorizontal: spacing.md, gap: spacing.md }}>
      <Text variant="title">{t('reviews.title')}</Text>
      {items.map((r) => (
        <ReviewRow key={r.user_id} review={r} />
      ))}
      <Button
        title={t('reviews.seeAll')}
        variant="ghost"
        onPress={() => router.push({ pathname: '/product/[slug]/reviews', params: { slug } })}
      />
    </Card>
  );
}

export function ReviewRow({ review }: { review: Review }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Stars value={review.rating} size={14} />
        <Text weight="semibold">{review.reviewer_name}</Text>
        <Text variant="caption" color="textMuted">
          · {t('reviews.verified')}
        </Text>
      </View>
      {review.comment ? <Text>{review.comment}</Text> : null}
      <Text variant="caption" color="textMuted">
        {formatDateTime(review.created_at, lang)}
        {review.is_hidden ? ` · ${t('reviews.hiddenForOthers')}` : ''}
      </Text>
    </View>
  );
}
