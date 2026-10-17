import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useStoreStatus } from '@/features/catalog/hooks';
import { formatPrice } from '@/lib/format';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Badge, Button, ErrorState, Skeleton, Text, showToast } from '@/ui';

import { alarmAvailable, alarmNeedsUnlock, startAlarm, stopAlarm, unlockAlarm } from './alarm';
import { COLUMNS, columnOf, setOrderStatus, type BoardOrder, type Column } from './api';
import { staffErrorMessage } from './errors';
import {
  buzz,
  countdown,
  useBoard,
  useNow,
  useStoreId,
  useStaffAction,
  useStoreOrdersRealtime,
  useTodaySummary,
} from './hooks';
import { useStoreMode } from './store';
import { StoreNav } from './StoreGate';
import { COLUMN_LOOK, CountBubble, ElapsedPill, StatTile } from './ui';

/** Keep the screen on while the board is open (no-op where unsupported). */
function KeepAwake() {
  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    void (async () => {
      try {
        const ka = await import('expo-keep-awake');
        if (!active || !(await ka.isAvailableAsync())) return;
        await ka.activateKeepAwakeAsync('store-board');
        release = () => void ka.deactivateKeepAwake('store-board');
      } catch {
        // native module missing until rebuild, or browser without Wake Lock
      }
    })();
    return () => {
      active = false;
      release?.();
    };
  }, []);
  return null;
}

/** Loops the alarm while any order waits to be accepted; buzzes when a new one arrives. */
function useNewOrderAlarm(newCount: number) {
  const soundOn = useStoreMode((s) => s.soundOn);
  const [unlocked, setUnlocked] = useState(!alarmNeedsUnlock);
  const prev = useRef(newCount);

  useEffect(() => {
    if (newCount > prev.current) buzz();
    prev.current = newCount;
  }, [newCount]);

  useEffect(() => {
    if (newCount > 0 && soundOn && unlocked) void startAlarm();
    else stopAlarm();
  }, [newCount, soundOn, unlocked]);

  useEffect(() => () => stopAlarm(), []);

  const unlock = async () => {
    const ok = await unlockAlarm();
    setUnlocked(ok);
    return ok;
  };
  return { unlocked, unlock };
}

function SoundToggle({ unlocked, unlock }: { unlocked: boolean; unlock: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { soundOn, setSoundOn } = useStoreMode();
  if (!alarmAvailable()) return null;
  const needsTap = soundOn && !unlocked;
  const onPress = async () => {
    if (needsTap) {
      if (!(await unlock())) showToast(t('storeOps.sound.blocked'), 'warning');
      return;
    }
    setSoundOn(!soundOn);
    if (!soundOn && alarmNeedsUnlock) await unlock();
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: soundOn && unlocked }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        minHeight: 40,
        borderRadius: radius.full,
        backgroundColor: needsTap ? colors.warning : colors.surfaceAlt,
      }}
    >
      <MaterialCommunityIcons
        name={soundOn && unlocked ? 'volume-high' : 'volume-off'}
        size={18}
        color={needsTap ? '#fff' : colors.text}
      />
      <Text variant="caption" weight="semibold" style={needsTap ? { color: '#fff' } : undefined}>
        {needsTap
          ? t('storeOps.sound.enable')
          : soundOn
            ? t('storeOps.sound.on')
            : t('storeOps.sound.off')}
      </Text>
    </Pressable>
  );
}

function SummaryStrip({ storeId }: { storeId: number | undefined }) {
  const { t } = useTranslation();
  const s = useTodaySummary(storeId).data;
  if (!s) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      <StatTile
        icon="receipt-text-outline"
        label={t('storeOps.summary.orders')}
        value={String(s.orders)}
        tone="info"
      />
      <StatTile
        icon="check-decagram-outline"
        label={t('storeOps.summary.delivered')}
        value={String(s.delivered)}
        tone="success"
      />
      <StatTile
        icon="cash-multiple"
        label={t('storeOps.summary.revenue')}
        value={formatPrice(Number(s.revenue))}
        tone="primary"
      />
      <StatTile
        icon="hand-coin-outline"
        label={t('storeOps.summary.codOutstanding')}
        value={formatPrice(Number(s.cod_outstanding))}
        tone="warning"
      />
      <StatTile
        icon="timer-sand"
        label={t('storeOps.summary.avgAccept')}
        value={s.avg_accept_sec != null ? `${Math.round(Number(s.avg_accept_sec) / 60)}m` : '–'}
        tone="discount"
      />
    </ScrollView>
  );
}

function OrderTile({ o, now }: { o: BoardOrder; now: number }) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const accept = useStaffAction(setOrderStatus);
  const col = columnOf(o.status);
  const look = COLUMN_LOOK[col ?? 'done'];
  const isNew = o.status === 'placed';
  const active = col !== 'done';
  const left = isNew ? countdown(o.auto_cancel_at, now) : null;
  const open = () => router.push({ pathname: '/store/order/[id]', params: { id: o.id } });

  const onAccept = () =>
    accept.mutate([o.id, 'confirmed'], {
      onSuccess: () => showToast(t('storeOps.statusUpdated'), 'success'),
      onError: (e) => showToast(staffErrorMessage(e), 'danger'),
    });

  return (
    <View
      style={{
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        borderLeftWidth: 4,
        borderLeftColor: colors[look.color],
        borderWidth: isNew ? 2 : isDark ? 1 : 0,
        borderColor: isNew ? colors.warning : colors.border,
        shadowColor: '#000',
        shadowOpacity: isDark ? 0 : 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: isDark ? 0 : 2,
        overflow: 'hidden',
      }}
    >
      <Pressable
        // Not a <button> on web: the card holds an Accept button below.
        accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
        accessibilityLabel={`${o.order_number} ${o.receiver_name ?? ''}`}
        onPress={open}
        style={({ pressed }) => ({
          padding: spacing.md,
          gap: spacing.xs,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="title" weight="bold" style={{ flex: 1 }} numberOfLines={1}>
            #{o.order_number.split('-').pop()}
          </Text>
          {active ? <ElapsedPill since={o.placed_at} now={now} /> : null}
        </View>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {o.order_number}
        </Text>
        <Text weight="semibold" numberOfLines={1}>
          {o.receiver_name ?? ''}
          {o.area ? <Text color="textMuted">{` · ${o.area}`}</Text> : null}
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text variant="caption" color="textMuted">
            {o.status === 'packing' || o.status === 'confirmed'
              ? t('storeOps.picked', { picked: o.picked_count, count: o.item_count })
              : t('storeOps.items', { count: o.item_count })}
          </Text>
          <Text weight="bold">{formatPrice(Number(o.grand_total))}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {o.status === 'cancelled' ? (
            <Badge label={t('order.status.cancelled')} tone="danger" />
          ) : null}
          {o.status === 'delivered' ? (
            <Badge label={t('order.status.delivered')} tone="success" />
          ) : null}
          {o.payment_method === 'cod' && o.status !== 'cancelled' ? (
            <Badge label={t('storeOps.collectCash')} tone="neutral" />
          ) : null}
          {o.is_first_order ? <Badge label={t('storeOps.firstOrder')} tone="info" /> : null}
          {o.customer_cancels_30d > 1 ? (
            <Badge
              label={t('storeOps.cancels', { count: o.customer_cancels_30d })}
              tone="warning"
            />
          ) : null}
          {o.has_note ? <Badge label={t('storeOps.hasNote')} tone="info" /> : null}
          {o.unavailable_count > 0 ? (
            <Badge
              label={t('storeOps.unavailableCount', { count: o.unavailable_count })}
              tone="warning"
            />
          ) : null}
        </View>
      </Pressable>
      {isNew ? (
        <View
          style={{
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.md,
          }}
        >
          {left ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceAlt,
              }}
            >
              <MaterialCommunityIcons name="alarm" size={16} color={colors.danger} />
              <Text variant="caption" weight="bold" color="danger">
                {t('storeOps.autoCancelIn', { time: left })}
              </Text>
            </View>
          ) : null}
          <Button
            title={t('storeOps.next.confirmed')}
            icon="check-bold"
            size="lg"
            fullWidth
            loading={accept.isPending}
            onPress={onAccept}
          />
        </View>
      ) : null}
    </View>
  );
}

function ColumnEmpty({ column }: { column: Column }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm, padding: spacing.xl }}>
      <MaterialCommunityIcons name={COLUMN_LOOK[column].icon} size={32} color={colors.outOfStock} />
      <Text color="textMuted" align="center">
        {column === 'new' ? t('storeOps.ui.emptyNew') : t('storeOps.emptyColumn')}
      </Text>
    </View>
  );
}

function ColumnList({
  column,
  orders,
  now,
}: {
  column: Column;
  orders: BoardOrder[];
  now: number;
}) {
  if (orders.length === 0) return <ColumnEmpty column={column} />;
  return (
    <View style={{ gap: spacing.sm }}>
      {orders.map((o) => (
        <OrderTile key={o.id} o={o} now={now} />
      ))}
    </View>
  );
}

function ColumnHeader({ column, count }: { column: Column; count: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const look = COLUMN_LOOK[column];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        borderTopWidth: 4,
        borderTopColor: colors[look.color],
        backgroundColor: colors.surface,
      }}
    >
      <MaterialCommunityIcons name={look.icon} size={18} color={colors[look.color]} />
      <Text weight="bold" style={{ flex: 1 }}>
        {t(`storeOps.columns.${column}`)}
      </Text>
      <CountBubble count={count} tone={look.color} />
    </View>
  );
}

export function BoardScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1000; // counter laptop / landscape tablet: all columns side by side
  const storeId = useStoreId();
  const store = useStoreStatus().data;
  const board = useBoard(storeId);
  useStoreOrdersRealtime(storeId);

  const grouped = useMemo(() => {
    const g = Object.fromEntries(COLUMNS.map((c) => [c, [] as BoardOrder[]])) as Record<
      Column,
      BoardOrder[]
    >;
    for (const o of board.data ?? []) {
      const c = columnOf(o.status);
      if (c) g[c].push(o);
    }
    g.done.reverse(); // most recent first
    return g;
  }, [board.data]);

  const newCount = grouped.new.length;
  const alarm = useNewOrderAlarm(newCount);
  const now = useNow((board.data ?? []).length > 0);
  const [tab, setTab] = useState<Column>('new');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <KeepAwake />
      <StoreNav right={<SoundToggle unlocked={alarm.unlocked} unlock={alarm.unlock} />} />
      {store && !store.accepting ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/store/settings')}
          style={{
            backgroundColor: colors.danger,
            padding: spacing.sm,
            minHeight: 44,
            justifyContent: 'center',
          }}
        >
          <Text align="center" weight="bold" style={{ color: '#fff' }}>
            {t('storeOps.store.pausedBanner')}
          </Text>
        </Pressable>
      ) : null}
      {newCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setTab('new')}
          style={{ backgroundColor: colors.warning, padding: spacing.md }}
        >
          <Text align="center" weight="bold" style={{ color: '#fff' }}>
            {t('storeOps.newBanner', { count: newCount })}
          </Text>
        </Pressable>
      ) : null}
      <SummaryStrip storeId={storeId} />

      {board.isPending ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width="100%" height={90} />
          <Skeleton width="100%" height={90} />
        </View>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : wide ? (
        <ScrollView horizontal contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
          {COLUMNS.map((c) => (
            <View
              key={c}
              style={{
                width: 290,
                borderRadius: radius.lg,
                backgroundColor: colors.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <ColumnHeader column={c} count={grouped[c].length} />
              <ScrollView
                contentContainerStyle={{ padding: spacing.sm, paddingBottom: spacing.xl }}
                refreshControl={
                  <RefreshControl
                    refreshing={board.isRefetching}
                    onRefresh={() => void board.refetch()}
                  />
                }
              >
                <ColumnList column={c} orders={grouped[c]} now={now} />
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.sm,
            }}
          >
            {COLUMNS.map((c) => {
              const active = tab === c;
              const look = COLUMN_LOOK[c];
              const urgent = c === 'new' && grouped.new.length > 0;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(c)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xs,
                    paddingLeft: spacing.md,
                    paddingRight: spacing.sm,
                    minHeight: 44,
                    borderRadius: radius.full,
                    borderWidth: urgent && !active ? 2 : 1,
                    borderColor: urgent
                      ? colors.warning
                      : active
                        ? colors[look.color]
                        : colors.border,
                    backgroundColor: active ? colors[look.color] : colors.surface,
                  }}
                >
                  <MaterialCommunityIcons
                    name={look.icon}
                    size={16}
                    color={active ? '#fff' : colors[look.color]}
                  />
                  <Text weight="semibold" style={{ color: active ? '#fff' : colors.text }}>
                    {t(`storeOps.columns.${c}`)}
                  </Text>
                  <View
                    style={{
                      minWidth: 22,
                      height: 22,
                      paddingHorizontal: 6,
                      borderRadius: radius.full,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? 'rgba(255,255,255,0.25)' : colors.surfaceAlt,
                    }}
                  >
                    <Text
                      variant="caption"
                      weight="bold"
                      style={{ color: active ? '#fff' : colors.text, fontSize: 12 }}
                    >
                      {grouped[c].length}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView
            contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
            refreshControl={
              <RefreshControl
                refreshing={board.isRefetching}
                onRefresh={() => void board.refetch()}
              />
            }
          >
            <ColumnList column={tab} orders={grouped[tab]} now={now} />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}
