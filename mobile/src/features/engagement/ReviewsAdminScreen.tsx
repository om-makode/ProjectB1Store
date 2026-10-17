import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AdminShell, ChoiceRow, confirmAction } from '@/features/admin/components';
import { useLocalize } from '@/i18n/localize';
import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  showToast,
  Skeleton,
  Text,
  TextField,
} from '@/ui';

import { useAdminReviews, useSetReviewHidden, type AdminReview, type ReviewFilter } from './admin';
import { Stars } from './components';

/** Admin: moderate reviews (hide abusive / off-topic ones with a reason; never edit them). */
export function ReviewsAdminScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const q = useAdminReviews(filter);

  return (
    <AdminShell title={t('admin.nav.reviews')}>
      <ChoiceRow
        label={t('reviewsAdmin.filter')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('reviewsAdmin.all') },
          { value: 'low', label: t('reviewsAdmin.low') },
          { value: 'hidden', label: t('reviewsAdmin.hidden') },
        ]}
      />
      {q.isPending ? (
        <Skeleton width="100%" height={200} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="star-outline" title={t('reviewsAdmin.empty')} message="" />
      ) : (
        q.data.map((r) => <AdminReviewCard key={`${r.product_id}-${r.user_id}`} review={r} />)
      )}
    </AdminShell>
  );
}

function AdminReviewCard({ review }: { review: AdminReview }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const lang = useSettings((s) => s.language);
  const mutate = useSetReviewHidden();
  const [reason, setReason] = useState('');

  const hide = async () => {
    const ok = await confirmAction(
      t('reviewsAdmin.hideTitle'),
      t('reviewsAdmin.hideBody'),
      t('reviewsAdmin.hide'),
      t('common.cancel'),
    );
    if (!ok) return;
    mutate.mutate(
      { review, hidden: true, reason: reason.trim() || null },
      { onError: () => showToast(t('errors.server'), 'danger') },
    );
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}
      >
        <Stars value={review.rating} />
        <Text weight="semibold">{review.reviewer_name}</Text>
        <Text variant="caption" color="textMuted">
          {review.products ? l(review.products.name) : ''} ·{' '}
          {formatDateTime(review.created_at, lang)}
        </Text>
        {review.is_hidden ? <Badge label={t('reviewsAdmin.hiddenBadge')} tone="danger" /> : null}
      </View>
      {review.comment ? <Text>{review.comment}</Text> : null}
      {review.is_hidden ? (
        <>
          {review.hidden_reason ? (
            <Text variant="caption" color="textMuted">
              {t('reviewsAdmin.reason')}: {review.hidden_reason}
            </Text>
          ) : null}
          <Button
            title={t('reviewsAdmin.unhide')}
            variant="secondary"
            loading={mutate.isPending}
            onPress={() => mutate.mutate({ review, hidden: false, reason: null })}
          />
        </>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <TextField
            label={t('reviewsAdmin.reasonLabel')}
            value={reason}
            onChangeText={setReason}
            placeholder={t('reviewsAdmin.reasonPlaceholder')}
          />
          <Button
            title={t('reviewsAdmin.hide')}
            variant="danger"
            loading={mutate.isPending}
            onPress={() => void hide()}
          />
        </View>
      )}
    </Card>
  );
}
