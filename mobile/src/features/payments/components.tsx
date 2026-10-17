import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { OrderDetail } from '@/features/orders/api';
import { formatDateTime, formatPrice } from '@/lib/format';
import { toAppError } from '@/lib/errors';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { Badge, Button, Card, Text, showToast } from '@/ui';

import type { PaymentErrorCode, Refund } from './api';
import { canOpenCheckout } from './checkout';
import { useOrderPayments, usePayOrder, useSwitchToCod } from './hooks';

/** mm:ss left until the stock hold ends (re-renders every second). */
function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

const ERROR_KEY: Record<PaymentErrorCode, string> = {
  payments_not_configured: 'payments.errors.notConfigured',
  unauthorized: 'payments.errors.generic',
  not_found: 'payments.errors.generic',
  not_payable: 'payments.errors.notPayable',
  hold_expired: 'payments.errors.holdExpired',
  bad_signature: 'payments.errors.generic',
  provider_error: 'payments.errors.generic',
  checkout_unavailable: 'payments.errors.needsUpdate',
  dismissed: 'payments.errors.dismissed',
  failed: 'payments.errors.failed',
  network: 'errors.network',
};

/**
 * Order detail while `awaiting_payment`: countdown, Pay now, Switch to pay on delivery.
 * Opens Checkout by itself once when arriving from checkout (`?pay=1`).
 */
export function PayNowBanner({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const { pay: payParam } = useLocalSearchParams<{ pay?: string }>();
  const { pay, state } = usePayOrder(order.id);
  const toCod = useSwitchToCod(order.id);
  const payments = useOrderPayments(order.id);
  const countdown = useCountdown(order.payment_expires_at);
  const autoStarted = useRef(false);
  const available = canOpenCheckout();

  useEffect(() => {
    if (payParam === '1' && available && !autoStarted.current) {
      autoStarted.current = true;
      void pay();
    }
  }, [payParam, available, pay]);

  const lastFailed = payments.data?.attempts.find((a) => a.status === 'failed');
  const working = state.kind === 'working';

  const switchToCod = () =>
    toCod.mutate(undefined, {
      onSuccess: () => showToast(t('payments.switchedToCod'), 'success'),
      onError: (e) => {
        const msg = toAppError(e).message;
        showToast(
          msg.includes('COD_LIMIT_EXCEEDED')
            ? t('orderErrors.COD_LIMIT_EXCEEDED')
            : msg.includes('COD_NOT_ALLOWED')
              ? t('orderErrors.COD_NOT_ALLOWED')
              : t('errors.server'),
          'danger',
        );
      },
    });

  let message: string;
  if (state.kind === 'pending' || state.kind === 'done') message = t('payments.confirming');
  else if (state.kind === 'error')
    message =
      state.error.code === 'failed' && state.error.message !== 'failed'
        ? t('payments.errors.failedWith', { reason: state.error.message })
        : t(ERROR_KEY[state.error.code] as 'payments.errors.generic');
  else if (lastFailed)
    message = t('payments.errors.failedWith', {
      reason: lastFailed.error_description ?? t('payments.errors.failed'),
    });
  else message = t('payments.completeToPlace');

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="title">
          {t('payments.payTitle', { amount: formatPrice(Number(order.grand_total)) })}
        </Text>
        {countdown ? (
          <Badge
            label={t('payments.timeLeft', { time: countdown.label })}
            tone={countdown.left < 120 ? 'danger' : 'info'}
          />
        ) : null}
      </View>
      <Text
        color={state.kind === 'error' || lastFailed ? 'danger' : 'textMuted'}
        accessibilityLiveRegion="polite"
      >
        {message}
      </Text>
      {available ? (
        <Button
          testID="pay-now"
          title={t('payments.payNow', { amount: formatPrice(Number(order.grand_total)) })}
          icon="qrcode-scan"
          loading={working || state.kind === 'pending'}
          disabled={working || state.kind === 'pending' || countdown?.left === 0}
          onPress={() => void pay()}
          fullWidth
        />
      ) : (
        <Text variant="caption" color="textMuted">
          {t('payments.errors.needsUpdate')}
        </Text>
      )}
      <Button
        title={t('payments.switchToCod')}
        variant="secondary"
        icon="cash"
        loading={toCod.isPending}
        disabled={working}
        onPress={switchToCod}
        fullWidth
      />
      <Text variant="caption" color="textMuted">
        {t('payments.holdHint')}
      </Text>
    </Card>
  );
}

const REFUND_TONE = {
  pending: 'info',
  processing: 'info',
  processed: 'success',
  failed: 'warning',
} as const;

/** Refunds for an online-paid order (cancelled, item unavailable, late/duplicate payment). */
export function RefundStatus({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const q = useOrderPayments(orderId);
  const refunds = q.data?.refunds ?? [];
  const paid = q.data?.attempts.find((a) => a.status === 'captured');
  if (!paid && refunds.length === 0) return null;

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="title" accessibilityRole="header">
        {t('payments.paymentTitle')}
      </Text>
      {paid ? (
        <Text color="success" weight="medium">
          {t('payments.paidOnline', {
            amount: formatPrice(Number(paid.amount)),
            method: paid.method ? paid.method.toUpperCase() : 'Razorpay',
          })}
        </Text>
      ) : null}
      {refunds.map((r: Refund) => (
        <View key={r.id} style={{ gap: spacing.xs }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text weight="medium">
              {t('payments.refundOf', { amount: formatPrice(Number(r.amount)) })}
            </Text>
            <Badge label={t(`payments.refundStatus.${r.status}`)} tone={REFUND_TONE[r.status]} />
          </View>
          <Text variant="caption" color="textMuted">
            {r.status === 'processed'
              ? t('payments.refundDone', { date: formatDateTime(r.updated_at, lang) })
              : r.status === 'failed'
                ? t('payments.refundDelayed')
                : t('payments.refundStarted', { date: formatDateTime(r.created_at, lang) })}
            {r.provider_refund_id && !r.provider_refund_id.startsWith('manual_')
              ? ` · ${t('payments.ref')}: ${r.provider_refund_id}`
              : ''}
          </Text>
        </View>
      ))}
    </Card>
  );
}
