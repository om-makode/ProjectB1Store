import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { cartQuoteKey } from '@/features/cart/sync';
import { ProductImage } from '@/features/catalog/components/ProductImage';
import { PayNowBanner, RefundStatus } from '@/features/payments/components';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  ProgressBar,
  ScreenHeader,
  Sheet,
  Skeleton,
  Text,
  showToast,
} from '@/ui';

import {
  ACTIVE_STATUSES,
  TIMELINE,
  canCustomerCancel,
  canReportIssue,
  cancelOrder,
  reorderToCart,
  type OrderDetail,
} from './api';
import { StatusTimeline } from './components/StatusTimeline';
import { orderActionMessage } from './errors';
import { orderKeys, useOrderDetail, useOrderIssues } from './hooks';
import { canPrintInvoice, openInvoice } from './invoice';

const CANCEL_REASONS = [
  'changed_mind',
  'wrong_items',
  'wrong_address',
  'too_slow',
  'other',
] as const;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text weight={strong ? 'bold' : 'regular'} color={strong ? 'text' : 'textMuted'}>
        {label}
      </Text>
      <Text weight={strong ? 'bold' : 'medium'}>{value}</Text>
    </View>
  );
}

function CancelSheet({
  order,
  visible,
  onClose,
}: {
  order: OrderDetail;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number] | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      // Stored in English for the store staff; the customer sees it in their language here.
      await cancelOrder(order.id, t(`order.cancelReasons.${reason}`, { lng: 'en' }));
      showToast(t('order.cancelledToast'), 'success');
      onClose();
    } catch (e) {
      showToast(orderActionMessage(e), 'danger');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: orderKeys.all });
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('order.cancelTitle')}>
      <View style={{ gap: spacing.md }}>
        <Text color="textMuted">{t('order.cancelHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CANCEL_REASONS.map((r) => (
            <Chip
              key={r}
              label={t(`order.cancelReasons.${r}`)}
              selected={reason === r}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
        <Button
          testID="order-cancel-confirm"
          title={t('order.cancelConfirm')}
          variant="danger"
          disabled={!reason}
          loading={busy}
          onPress={submit}
          fullWidth
        />
        <Button title={t('order.keepOrder')} variant="ghost" onPress={onClose} fullWidth />
      </View>
    </Sheet>
  );
}

export function OrderScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const l = useLocalize();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrderDetail(id);
  const order = q.data;
  const issues = useOrderIssues(id, order?.status === 'delivered');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  // OrdersLive (Realtime) keeps this fresh while open; refetch on return in case events were missed.
  useFocusEffect(
    useCallback(() => {
      void q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]),
  );

  const reorder = async () => {
    if (!order) return;
    setReordering(true);
    try {
      const res = await reorderToCart(order.id);
      void qc.invalidateQueries({ queryKey: cartQuoteKey }); // local cart follows the server cart
      if (!res.added.length) {
        showToast(t('order.reorderNone'), 'warning');
        return;
      }
      if (res.missing.length) {
        const names = res.missing.map((m) => l(asLocalized(m.name))).join(', ');
        showToast(t('order.reorderMissing', { names }), 'warning');
      } else {
        showToast(t('order.reorderDone'), 'success');
      }
      router.push('/cart');
    } catch (e) {
      showToast(orderActionMessage(e), 'danger');
    } finally {
      setReordering(false);
    }
  };

  const invoice = async () => {
    if (!order) return;
    try {
      await openInvoice(order, lang);
    } catch {
      showToast(t('invoice.failed'), 'danger');
    }
  };

  const callStore = () => {
    const phone = order?.stores?.phone;
    if (phone) void Linking.openURL(`tel:${phone}`);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        title={order ? order.order_number : t('order.title')}
        subtitle={
          order?.placed_at
            ? t('order.placedAt', { time: formatDateTime(order.placed_at, lang) })
            : undefined
        }
      />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {q.isPending ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="100%" height={120} />
            <Skeleton width="100%" height={220} />
          </View>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : order ? (
          <ScrollView
            contentContainerStyle={{
              padding: spacing.lg,
              gap: spacing.md,
              paddingBottom: 48,
              width: '100%',
              maxWidth: layout.readableMax,
              alignSelf: 'center',
            }}
            refreshControl={
              <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
            }
          >
            <OrderBody
              order={order}
              onCancel={() => setCancelOpen(true)}
              onReorder={reorder}
              reordering={reordering}
              onInvoice={invoice}
              onCallStore={callStore}
            />
            {issues.data?.length ? (
              <Card style={{ gap: spacing.sm }}>
                <Text variant="title" accessibilityRole="header">
                  {t('order.issuesTitle')}
                </Text>
                {issues.data.map((i) => (
                  <View key={i.id} style={{ gap: 2 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text weight="medium">{t(`issue.types.${i.type}`)}</Text>
                      <Badge
                        label={t(`order.issueStatus.${i.status}`)}
                        tone={
                          i.status === 'open'
                            ? 'warning'
                            : i.status === 'resolved'
                              ? 'success'
                              : 'neutral'
                        }
                      />
                    </View>
                    {i.message ? <Text color="textMuted">{i.message}</Text> : null}
                    {i.resolution_note ? <Text>{i.resolution_note}</Text> : null}
                  </View>
                ))}
              </Card>
            ) : null}
            <CancelSheet order={order} visible={cancelOpen} onClose={() => setCancelOpen(false)} />
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function OrderBody({
  order,
  onCancel,
  onReorder,
  reordering,
  onInvoice,
  onCallStore,
}: {
  order: OrderDetail;
  onCancel: () => void;
  onReorder: () => void;
  reordering: boolean;
  onInvoice: () => void;
  onCallStore: () => void;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const active = ACTIVE_STATUSES.includes(order.status);
  const mrpTotal = Number(order.mrp_total);
  const itemTotal = Number(order.item_total);
  const addr = (order.address_snapshot ?? {}) as Record<string, string | null>;
  const deliveryFee = Number(order.delivery_fee);

  return (
    <>
      <StatusHero order={order} />

      <Card style={{ gap: spacing.sm }}>
        {order.status === 'cancelled' ? (
          <>
            {order.cancelled_by ? (
              <Text color="danger">{t(`order.cancelledBy.${order.cancelled_by}`)}</Text>
            ) : null}
            {order.cancel_reason ? (
              <Text color="textMuted">{t('order.reason', { reason: order.cancel_reason })}</Text>
            ) : null}
          </>
        ) : null}
        <StatusTimeline status={order.status} events={order.order_status_events} />
      </Card>

      {order.status === 'awaiting_payment' ? <PayNowBanner order={order} /> : null}
      {order.payment_method === 'upi' ? <RefundStatus orderId={order.id} /> : null}

      <Card style={{ gap: spacing.md }}>
        <Text variant="title" accessibilityRole="header">
          {t('order.itemsTitle')}
        </Text>
        {order.order_items.map((i) => {
          const unavailable = i.status === 'unavailable';
          const name = l(asLocalized(i.name_snapshot));
          return (
            <View
              key={i.id}
              style={{
                flexDirection: 'row',
                gap: spacing.md,
                alignItems: 'center',
                opacity: unavailable ? 0.6 : 1,
              }}
            >
              <ProductImage path={i.image_path} name={name} size={48} />
              <View style={{ flex: 1 }}>
                <Text strike={unavailable} numberOfLines={2}>
                  {name}
                </Text>
                <Text variant="caption" color="textMuted">
                  {l(asLocalized(i.variant_label_snapshot))} × {i.quantity}
                </Text>
                {unavailable ? (
                  <Text variant="caption" color="danger">
                    {t('order.unavailable')}
                  </Text>
                ) : null}
              </View>
              <Text weight="medium" strike={unavailable}>
                {formatPrice(Number(i.line_total))}
              </Text>
            </View>
          );
        })}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="title" accessibilityRole="header">
          {t('order.bill')}
        </Text>
        <Row label={t('order.itemTotal')} value={formatPrice(itemTotal)} />
        <Row
          label={t('order.deliveryFee')}
          value={deliveryFee > 0 ? formatPrice(deliveryFee) : t('order.free')}
        />
        {Number(order.small_cart_fee) > 0 ? (
          <Row label={t('order.smallCartFee')} value={formatPrice(Number(order.small_cart_fee))} />
        ) : null}
        {Number(order.packaging_fee) > 0 ? (
          <Row label={t('order.packagingFee')} value={formatPrice(Number(order.packaging_fee))} />
        ) : null}
        <Row label={t('order.grandTotal')} value={formatPrice(Number(order.grand_total))} strong />
        {mrpTotal > itemTotal ? (
          <Text color="success" weight="medium">
            {t('order.savings')} {formatPrice(mrpTotal - itemTotal)}
          </Text>
        ) : null}
        <Text variant="caption" color="textMuted">
          {order.payment_method === 'cod' ? t('order.payCod') : t('order.payOnline')}
        </Text>
      </Card>

      <Card style={{ gap: spacing.xs }}>
        <Text variant="title" accessibilityRole="header">
          {t('order.deliverTo')}
        </Text>
        <Text weight="medium">
          {[addr.receiver_name, addr.receiver_phone].filter(Boolean).join(' · ')}
        </Text>
        <Text color="textMuted">
          {[addr.house, addr.area, addr.landmark, addr.city, addr.pincode]
            .filter(Boolean)
            .join(', ')}
        </Text>
        {order.customer_note ? (
          <Text variant="caption" color="textMuted">
            {t('order.yourNote')}: {order.customer_note}
          </Text>
        ) : null}
      </Card>

      <View style={{ gap: spacing.sm }}>
        {canCustomerCancel(order.status) ? (
          <Button
            testID="order-cancel"
            title={t('order.cancel')}
            variant="secondary"
            icon="close-circle-outline"
            onPress={onCancel}
            fullWidth
          />
        ) : null}
        {canReportIssue(order) ? (
          <Button
            title={t('order.reportIssue')}
            variant="secondary"
            icon="alert-circle-outline"
            onPress={() => router.push({ pathname: '/order/[id]/issue', params: { id: order.id } })}
            fullWidth
          />
        ) : null}
        {order.status === 'delivered' ? (
          <Button
            title={t('reviews.rateOrder')}
            variant="secondary"
            icon="star-outline"
            onPress={() =>
              router.push({ pathname: '/order/[id]/review', params: { id: order.id } })
            }
            fullWidth
          />
        ) : null}
        {!active ? (
          <Button
            title={t('order.reorder')}
            icon="cart-arrow-down"
            onPress={onReorder}
            loading={reordering}
            fullWidth
          />
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {order.status !== 'cancelled' && canPrintInvoice() ? (
            <View style={{ flex: 1 }}>
              <Button
                title={t('order.invoice')}
                variant="secondary"
                icon="file-document-outline"
                onPress={onInvoice}
                fullWidth
              />
            </View>
          ) : null}
          {order.stores?.phone ? (
            <View style={{ flex: 1 }}>
              <Button
                title={t('order.callStore')}
                variant="secondary"
                icon="phone-outline"
                onPress={onCallStore}
                fullWidth
              />
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
}

const STATUS_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  awaiting_payment: 'credit-card-clock-outline',
  placed: 'receipt-text-check-outline',
  confirmed: 'storefront-check-outline',
  packing: 'package-variant',
  packed: 'package-variant-closed-check',
  out_for_delivery: 'moped',
  delivered: 'check-decagram',
  cancelled: 'close-octagon-outline',
};

/** Big status card at the top: icon, status in words, progress across the steps. */
function StatusHero({ order }: { order: OrderDetail }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const cancelled = order.status === 'cancelled';
  const delivered = order.status === 'delivered';
  const idx = TIMELINE.indexOf(order.status);
  const progress = delivered ? 1 : idx < 0 ? 0 : (idx + 1) / TIMELINE.length;
  const bg = cancelled ? colors.dangerSoft : delivered ? colors.primarySoft : colors.accentSoft;
  const fg = cancelled ? colors.danger : delivered ? colors.primary : colors.text;
  const active = ACTIVE_STATUSES.includes(order.status);

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: bg, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <MaterialCommunityIcons
            name={STATUS_ICON[order.status] ?? 'receipt-text-outline'}
            size={28}
            color={fg}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h2" weight="bold" style={{ color: fg }} accessibilityRole="header">
            {t(`order.status.${order.status}` as 'order.status.placed')}
          </Text>
          {delivered && order.delivered_at ? (
            <Text variant="caption" color="textMuted">
              {t('order.deliveredAt', { time: formatDateTime(order.delivered_at, lang) })}
            </Text>
          ) : active ? (
            <Text variant="caption" color="textMuted">
              {t('order.liveHint')}
            </Text>
          ) : null}
        </View>
      </View>
      {cancelled ? null : (
        <ProgressBar value={progress} height={8} accessibilityLabel={t('order.progress')} />
      )}
    </View>
  );
}
