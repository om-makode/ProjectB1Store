import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { toAppError } from '@/lib/errors';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ScreenHeader,
  showToast,
  Skeleton,
  Text,
  TextField,
} from '@/ui';

import type { ReviewItem } from './api';
import { Stars } from './components';
import { useOrderReviewItems, useSubmitReview } from './hooks';

/** Rate the items of a delivered order (only verified buyers; the server checks again). */
export function OrderReviewScreen({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useOrderReviewItems(orderId);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={t('reviews.rateOrder')} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {q.isPending ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="100%" height={120} />
            <Skeleton width="100%" height={120} />
          </View>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <FlatList
            data={q.data}
            keyExtractor={(i) => String(i.product_id)}
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
            ListHeaderComponent={<Text color="textMuted">{t('reviews.rateIntro')}</Text>}
            ListEmptyComponent={
              <EmptyState
                icon="star-off-outline"
                title={t('reviews.nothingToRate')}
                message={t('reviews.nothingToRateBody')}
              />
            }
            renderItem={({ item }) => <ReviewItemCard orderId={orderId} item={item} />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function ReviewItemCard({ orderId, item }: { orderId: string; item: ReviewItem }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const lang = useSettings((s) => s.language);
  const submit = useSubmitReview(orderId);
  const [rating, setRating] = useState(item.my_rating ?? 0);
  const [comment, setComment] = useState(item.my_comment ?? '');
  const saved = item.my_rating != null;
  const dirty = rating !== (item.my_rating ?? 0) || comment.trim() !== (item.my_comment ?? '');
  const name = l(asLocalized(item.product_name));

  const save = () =>
    submit.mutate(
      { productId: item.product_id, rating, comment: comment.trim() || null, lang },
      {
        onSuccess: () => showToast(t('reviews.thanks'), 'success'),
        onError: (e) => {
          const err = toAppError(e);
          showToast(
            err.kind === 'forbidden' ? t('reviews.notAllowed') : t('errors.server'),
            'danger',
          );
        },
      },
    );

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <View style={{ width: 56 }}>
          <ProductImage path={item.thumb_path} name={name} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="semibold" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="caption" color="textMuted">
            {l(asLocalized(item.variant_label))}
          </Text>
        </View>
      </View>
      <Stars value={rating} onChange={setRating} size={28} />
      <TextField
        label={t('reviews.commentLabel')}
        placeholder={t('reviews.commentPlaceholder')}
        value={comment}
        onChangeText={setComment}
        maxLength={1000}
        multiline
      />
      <Button
        title={saved && !dirty ? t('reviews.saved') : t('reviews.submit')}
        icon={saved && !dirty ? 'check' : undefined}
        variant={saved && !dirty ? 'secondary' : 'primary'}
        disabled={rating === 0 || (saved && !dirty)}
        loading={submit.isPending}
        onPress={save}
      />
    </Card>
  );
}
