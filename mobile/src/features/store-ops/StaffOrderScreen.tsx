import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import type { OrderDetail, OrderItem } from '@/features/orders/api';
import { useOrderDetail } from '@/features/orders/hooks';
import { asLocalized, useLocalize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  ScreenHeader,
  Sheet,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import {
  markItemUnavailable,
  setOrderNote,
  setOrderStatus,
  STORE_CANCEL_REASONS,
  togglePicked,
  UNAVAILABLE_REASONS,
  type OrderStatus,
  type UnavailableReason,
} from './api';
import { staffErrorCode, staffErrorMessage } from './errors';
import { countdown, useBoard, useNow, useStaffAction, useStoreId, useTransitions } from './hooks';
import { printInvoice, printPickList } from './print';
import { useStoreMode, type Paper } from './store';
import { COLUMN_LOOK, ProgressBar } from './ui';
import { columnOf } from './api';

const addr = (o: OrderDetail) => (o.address_snapshot ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function mapsUrl(o: OrderDetail): string {
  const a = addr(o);
  const lat = Number(a.latitude);
  const lng = Number(a.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  const q = [a.house, a.area, a.landmark, a.city, a.pincode].map(str).filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function ItemRow({
  item,
  canPick,
  onToggle,
  onUnavailable,
  busy,
}: {
  item: OrderItem;
  canPick: boolean;
  onToggle: () => void;
  onUnavailable: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const gone = item.status === 'unavailable';
  const label = l(asLocalized(item.variant_label_snapshot));
  const name = l(asLocalized(item.name_snapshot));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        opacity: gone ? 0.5 : 1,
      }}
    >
      <Pressable
        // The whole row is the checkbox: easy to hit with a thumb while holding items.
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.picked, disabled: gone || !canPick }}
        accessibilityLabel={`${name}, ${item.quantity}`}
        disabled={gone || !canPick || busy}
        onPress={onToggle}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          minHeight: 64,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.md,
          backgroundColor: item.picked && !gone ? colors.surfaceAlt : 'transparent',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons
          name={item.picked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={30}
          color={item.picked ? colors.primary : colors.textMuted}
        />
        <ProductImage path={item.image_path} name={name} size={48} />
        <View style={{ flex: 1 }}>
          <Text weight="semibold" strike={gone} numberOfLines={2}>
            {name}
          </Text>
          <Text variant="caption" color="textMuted">
            {label ? `${label} · ` : ''}
            {formatPrice(Number(item.price))}
          </Text>
          {gone ? <Badge label={t('order.unavailable')} tone="warning" /> : null}
        </View>
        <View
          style={{
            minWidth: 44,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radius.md,
            alignItems: 'center',
            backgroundColor: item.quantity > 1 ? colors.accent : colors.surfaceAlt,
          }}
        >
          <Text
            variant="title"
            weight="bold"
            style={{ color: item.quantity > 1 ? colors.accentText : colors.text }}
          >
            {item.quantity}×
          </Text>
        </View>
      </Pressable>
      {!gone && canPick ? (
        <Button
          title={t('storeOps.markUnavailable')}
          variant="ghost"
          icon="close-octagon-outline"
          onPress={onUnavailable}
        />
      ) : null}
    </View>
  );
}

/** Keyed by the saved note, so it resets when another tablet saves a new one. */
function StaffNoteCard({ order, onError }: { order: OrderDetail; onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(order.staff_note ?? '');
  const saveNote = useStaffAction(setOrderNote);
  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <TextField
          label={t('storeOps.staffNote')}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={500}
        />
        <Button
          title={t('storeOps.saveNote')}
          variant="ghost"
          loading={saveNote.isPending}
          disabled={note === (order.staff_note ?? '')}
          onPress={() =>
            saveNote.mutate([order.id, note], {
              onSuccess: () => showToast(t('storeOps.noteSaved'), 'success'),
              onError,
            })
          }
        />
      </View>
    </Card>
  );
}

function nextLabel(from: OrderStatus, to: OrderStatus, t: TFunction) {
  if (from === 'packed' && to === 'delivered') return t('storeOps.deliveredFromPacked');
  return to === 'confirmed' ||
    to === 'packing' ||
    to === 'packed' ||
    to === 'out_for_delivery' ||
    to === 'delivered'
    ? t(`storeOps.next.${to}`)
    : to;
}

export function StaffOrderScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrderDetail(id);
  const order = q.data;
  const storeId = useStoreId();
  const boardRow = useBoard(storeId).data?.find((b) => b.id === id);
  const nextOf = useTransitions();
  const { paper, setPaper } = useStoreMode();

  const [unavailableFor, setUnavailableFor] = useState<OrderItem | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const now = useNow(order?.status === 'placed');
  const left = order?.status === 'placed' ? countdown(boardRow?.auto_cancel_at, now) : null;

  const onError = (e: unknown) => {
    showToast(staffErrorMessage(e), 'danger');
    if (staffErrorCode(e) === 'INVALID_TRANSITION') void q.refetch();
  };
  const status = useStaffAction(setOrderStatus);
  const pick = useStaffAction(togglePicked);
  const unavailable = useStaffAction(markItemUnavailable);

  if (q.isPending) {
    return (
      <SafeAreaView style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
        <Skeleton width="100%" height={56} />
        <Skeleton width="100%" height={200} />
      </SafeAreaView>
    );
  }
  if (q.isError || !order) {
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <ScreenHeader title={t('order.title')} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </SafeAreaView>
    );
  }

  const a = addr(order);
  const phone = str(a.receiver_phone);
  const final = order.status === 'delivered' || order.status === 'cancelled';
  const canPick = order.status === 'confirmed' || order.status === 'packing';
  const nexts = nextOf(order.status);
  const active = order.order_items.filter((i) => i.status === 'active');
  const allPicked = active.length > 0 && active.every((i) => i.picked);
  const pickedCount = active.filter((i) => i.picked).length;
  const look = COLUMN_LOOK[columnOf(order.status) ?? 'done'];

  const doPrint = async (fn: typeof printPickList) => {
    try {
      await fn(order, lang, paper);
    } catch (e) {
      showToast(staffErrorMessage(e), 'danger');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScreenHeader
        title={order.order_number}
        subtitle={`${t(`order.status.${order.status}`)} · ${formatDateTime(order.placed_at, lang)}`}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
        }
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radius.lg,
            backgroundColor: colors[look.color],
          }}
        >
          <MaterialCommunityIcons name={look.icon} size={24} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text weight="bold" style={{ color: '#fff' }}>
              {t(`order.status.${order.status}`)}
            </Text>
            {left ? (
              <Text variant="caption" weight="semibold" style={{ color: '#fff' }}>
                {t('storeOps.autoCancelIn', { time: left })}
              </Text>
            ) : null}
          </View>
          <Text variant="title" weight="bold" style={{ color: '#fff' }}>
            {formatPrice(Number(order.grand_total))}
          </Text>
        </View>

        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text variant="caption" color="textMuted">
              {t('storeOps.customer')}
            </Text>
            <Text variant="title">{str(a.receiver_name)}</Text>
            <Text color="textMuted">
              {[a.house, a.area, a.landmark, a.city, a.pincode].map(str).filter(Boolean).join(', ')}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                flexWrap: 'wrap',
                marginTop: spacing.sm,
              }}
            >
              {phone ? (
                <Button
                  title={`${t('storeOps.call')} ${phone}`}
                  icon="phone"
                  size="lg"
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                />
              ) : null}
              <Button
                title={t('storeOps.openMaps')}
                icon="map-marker-outline"
                variant="secondary"
                size="lg"
                onPress={() => void Linking.openURL(mapsUrl(order))}
              />
            </View>
            {order.customer_note ? (
              <View
                style={{
                  marginTop: spacing.sm,
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: colors.warning,
                }}
              >
                <Text variant="caption" color="textMuted">
                  {t('storeOps.customerNote')}
                </Text>
                <Text weight="semibold">{order.customer_note}</Text>
              </View>
            ) : null}
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text variant="title">{t('storeOps.pickChecklist')}</Text>
              <Text weight="bold" color={allPicked ? 'success' : 'text'}>
                {t('storeOps.picked', { picked: pickedCount, count: active.length })}
              </Text>
            </View>
            <ProgressBar
              value={active.length ? pickedCount / active.length : 0}
              tone={allPicked ? 'success' : 'primary'}
            />
            <Text variant="caption" color="textMuted">
              {order.status === 'placed' ? t('storeOps.acceptFirst') : t('storeOps.pickHint')}
            </Text>
            {order.order_items.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                canPick={canPick}
                busy={pick.isPending}
                onToggle={() => pick.mutate([i.id, !i.picked], { onError })}
                onUnavailable={() => setUnavailableFor(i)}
              />
            ))}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginTop: spacing.sm,
              }}
            >
              <Text weight="bold">{t('order.grandTotal')}</Text>
              <Text weight="bold">{formatPrice(Number(order.grand_total))}</Text>
            </View>
            {order.payment_method === 'cod' ? (
              <Badge label={t('storeOps.collectCash')} tone="warning" />
            ) : null}
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.sm }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                flexWrap: 'wrap',
              }}
            >
              <Text weight="semibold">{t('storeOps.paper')}</Text>
              {(['a4', '80mm', '58mm'] as Paper[]).map((p) => (
                <Chip
                  key={p}
                  label={t(`storeOps.papers.${p}`)}
                  selected={paper === p}
                  onPress={() => setPaper(p)}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Button
                title={t('storeOps.printPickList')}
                icon="printer-outline"
                variant="secondary"
                onPress={() => void doPrint(printPickList)}
              />
              <Button
                title={t('storeOps.printInvoice')}
                icon="receipt"
                variant="secondary"
                onPress={() => void doPrint(printInvoice)}
              />
            </View>
          </View>
        </Card>

        <StaffNoteCard key={order.staff_note ?? ''} order={order} onError={onError} />

        {!final ? (
          <Button
            title={t('storeOps.cancel')}
            variant="ghost"
            icon="close-circle-outline"
            onPress={() => setCancelOpen(true)}
          />
        ) : null}
      </ScrollView>

      {!final && nexts.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: spacing.md,
            gap: spacing.sm,
            flexDirection: 'row',
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: -2 },
            elevation: 8,
          }}
        >
          {nexts
            // 'packing' starts automatically on the first tick; show it only when nothing is picked yet
            .filter((s) => !(s === 'packing' && nexts.includes('packed') && allPicked))
            .map((s, idx) => (
              <View key={s} style={{ flex: 1 }}>
                <Button
                  title={nextLabel(order.status, s, t)}
                  size="lg"
                  variant={idx === 0 ? 'primary' : 'secondary'}
                  loading={status.isPending && status.variables?.[1] === s}
                  disabled={status.isPending}
                  fullWidth
                  onPress={() =>
                    status.mutate([order.id, s], {
                      onSuccess: () => showToast(t('storeOps.statusUpdated'), 'success'),
                      onError,
                    })
                  }
                />
              </View>
            ))}
        </View>
      ) : null}

      <Sheet
        visible={!!unavailableFor}
        onClose={() => setUnavailableFor(null)}
        title={t('storeOps.unavailableTitle')}
      >
        <View style={{ gap: spacing.sm }}>
          <Text color="textMuted">{t('storeOps.ui.unavailableHint')}</Text>
          {UNAVAILABLE_REASONS.map((r: UnavailableReason) => (
            <Button
              key={r}
              title={t(`storeOps.reasons.${r}`)}
              variant="secondary"
              loading={unavailable.isPending && unavailable.variables?.[1] === r}
              disabled={unavailable.isPending}
              fullWidth
              onPress={() =>
                unavailableFor &&
                unavailable.mutate([unavailableFor.id, r], {
                  onSuccess: () => {
                    showToast(t('storeOps.unavailableDone'), 'success');
                    setUnavailableFor(null);
                  },
                  onError,
                })
              }
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('storeOps.cancelTitle')}
      >
        <View style={{ gap: spacing.sm }}>
          <Text color="textMuted">{t('storeOps.cancelHint')}</Text>
          {STORE_CANCEL_REASONS.map((r) => (
            <Button
              key={r}
              title={t(`storeOps.cancelReasons.${r}`)}
              variant="secondary"
              disabled={status.isPending}
              fullWidth
              onPress={() =>
                // Reason stored in English for records; the customer's app shows it as written.
                status.mutate(
                  [order.id, 'cancelled', t(`storeOps.cancelReasons.${r}`, { lng: 'en' })],
                  {
                    onSuccess: () => {
                      showToast(t('storeOps.cancelled'), 'success');
                      setCancelOpen(false);
                    },
                    onError,
                  },
                )
              }
            />
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
