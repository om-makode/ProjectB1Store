import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AdminShell, ChoiceRow, confirmAction } from '@/features/admin/components';
import { formatDateTime, formatPrice } from '@/lib/format';
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

import type { AdminRefund } from './api';
import { useAdminRefunds, useResolveRefund } from './hooks';

const TONE = {
  pending: 'info',
  processing: 'info',
  processed: 'success',
  failed: 'danger',
} as const;

/**
 * Admin → Refunds. Refunds are sent to Razorpay automatically (process-refunds, every 2 min,
 * up to 5 attempts). One that keeps failing can be closed after paying the customer back by hand.
 */
export function RefundsAdminScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'attention' | 'all'>('attention');
  const q = useAdminRefunds(filter);

  return (
    <AdminShell
      title={t('admin.nav.refunds')}
      actions={
        <Button
          title={t('admin.reports.v_payments_daily')}
          variant="ghost"
          icon="chart-bar"
          onPress={() =>
            router.push({
              pathname: '/admin/reports/[report]',
              params: { report: 'v_payments_daily' },
            })
          }
        />
      }
    >
      <Text color="textMuted">{t('refundsAdmin.hint')}</Text>
      <ChoiceRow
        label={t('refundsAdmin.filter')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'attention', label: t('refundsAdmin.attention') },
          { value: 'all', label: t('refundsAdmin.all') },
        ]}
      />
      {q.isPending ? (
        <Skeleton width="100%" height={200} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="cash-refund" title={t('refundsAdmin.empty')} message="" />
      ) : (
        q.data.map((r) => <RefundCard key={r.id} refund={r} />)
      )}
    </AdminShell>
  );
}

function RefundCard({ refund: r }: { refund: AdminRefund }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const resolve = useResolveRefund();
  const [note, setNote] = useState('');
  const open = r.status !== 'processed';

  const markManual = async () => {
    if (!note.trim()) return showToast(t('refundsAdmin.noteRequired'), 'danger');
    const ok = await confirmAction(
      t('refundsAdmin.manualTitle'),
      t('refundsAdmin.manualBody', { amount: formatPrice(Number(r.amount)) }),
      t('refundsAdmin.manual'),
      t('common.cancel'),
    );
    if (!ok) return;
    resolve.mutate(
      { id: r.id, note: note.trim() },
      {
        onSuccess: () => showToast(t('refundsAdmin.closed'), 'success'),
        onError: () => showToast(t('errors.server'), 'danger'),
      },
    );
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}
      >
        <Text weight="semibold">{r.orders?.order_number ?? r.order_id.slice(0, 8)}</Text>
        <Text weight="bold">{formatPrice(Number(r.amount))}</Text>
        <Badge label={t(`payments.refundStatus.${r.status}`)} tone={TONE[r.status]} />
        <Badge
          label={t(`refundsAdmin.reason.${r.reason}` as 'refundsAdmin.reason.manual')}
          tone="neutral"
        />
      </View>
      <Text variant="caption" color="textMuted">
        {formatDateTime(r.created_at, lang)} · {t('refundsAdmin.attempts', { count: r.attempts })}
        {r.provider_refund_id ? ` · ${r.provider_refund_id}` : ''}
      </Text>
      {r.last_error ? (
        <Text variant="caption" color="danger">
          {r.last_error}
        </Text>
      ) : null}
      {r.resolved_note ? (
        <Text variant="caption" color="textMuted">
          {t('refundsAdmin.note')}: {r.resolved_note}
        </Text>
      ) : null}
      {open ? (
        <View style={{ gap: spacing.sm }}>
          <TextField
            label={t('refundsAdmin.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('refundsAdmin.notePlaceholder')}
          />
          <Button
            title={t('refundsAdmin.manual')}
            variant="secondary"
            icon="hand-coin-outline"
            loading={resolve.isPending}
            onPress={() => void markManual()}
          />
        </View>
      ) : null}
    </Card>
  );
}
