import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DeliveryLocationBar } from '@/features/location/DeliveryLocationBar';
import { WishlistHeaderButton } from '@/features/engagement/components';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useLocalize } from '@/i18n/localize';
import { formatDateTime, formatPrice } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { layout, radius, shadow, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Skeleton, Text } from '@/ui';

import type { StoreStatus } from '../types';

/** Header background: Blinkit yellow while open, neutral when closed/paused. */
export function useHeaderColors(store: StoreStatus | null | undefined) {
  const { colors } = useTheme();
  const open = !!store?.is_open;
  return {
    open,
    bg: open ? colors.accent : colors.surfaceAlt,
    fg: open ? colors.accentText : colors.text,
    muted: open ? colors.accentText : colors.textMuted,
  };
}

/** "Delivery in 20 minutes" headline + location, like the top of Blinkit's home. */
export function StoreHeader({
  store,
  loading,
}: {
  store: StoreStatus | null | undefined;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const l = useLocalize();
  const lang = useSettings((s) => s.language);
  const { open, bg, fg, muted } = useHeaderColors(store);

  let headline = '';
  let detail = '';
  if (store) {
    if (store.is_open) {
      headline = t('home.deliveryIn', { minutes: store.eta_minutes });
    } else if (!store.accepting) {
      headline = t('store.paused');
    } else {
      headline = t('store.closed');
      if (store.opens_at)
        detail = t('store.opensAt', { time: formatDateTime(store.opens_at, lang) });
    }
    const msg = store.message ? l(store.message) : '';
    if (msg) detail = msg;
  }

  return (
    <View style={{ backgroundColor: bg }}>
      <View
        style={{
          width: '100%',
          maxWidth: layout.contentMax,
          alignSelf: 'center',
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          gap: spacing.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            {loading && !store ? (
              <View style={{ gap: spacing.xs }}>
                <Skeleton width="60%" height={28} />
                <Skeleton width="40%" height={14} />
              </View>
            ) : store ? (
              <View accessible accessibilityRole="header">
                <Text variant="caption" weight="bold" style={{ color: muted, letterSpacing: 0.4 }}>
                  {open ? t('home.greeting') : l(store.name)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <MaterialCommunityIcons
                    name={open ? 'lightning-bolt' : 'store-clock-outline'}
                    size={open ? 26 : 24}
                    color={fg}
                  />
                  <Text variant="h1" weight="bold" style={{ color: fg, flexShrink: 1 }}>
                    {headline}
                  </Text>
                </View>
                {detail ? (
                  <Text
                    variant="caption"
                    weight="semibold"
                    numberOfLines={2}
                    style={{ color: muted }}
                  >
                    {detail}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <WishlistHeaderButton />
          <NotificationBell />
        </View>
        <DeliveryLocationBar color={fg} />
      </View>
    </View>
  );
}

const HINTS = ['milk', 'atta', 'चहा', 'bread', 'साबण', 'eggs'];

/** Search pill that stays pinned at the top while Home scrolls; the hint rotates every 3 s. */
export function HomeSearchBar({ store }: { store: StoreStatus | null | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { bg } = useHeaderColors(store);
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % HINTS.length), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <View
      style={{ backgroundColor: bg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg }}
    >
      <Pressable
        testID="search-bar"
        accessibilityRole="search"
        accessibilityLabel={t('catalog.searchPlaceholder')}
        onPress={() => router.push('/search')}
        style={({ pressed }) => [
          {
            width: '100%',
            maxWidth: layout.contentMax - spacing.lg * 2,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: 50,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            opacity: pressed ? 0.95 : 1,
          },
          shadow.sm,
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={22} color={colors.text} />
        <Text color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
          {t('home.searchHint', { term: HINTS[i] })}
        </Text>
        <View style={{ width: 1, height: 22, backgroundColor: colors.border }} />
        <MaterialCommunityIcons name="microphone-outline" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}

/** Small reassurance chips under the search: free delivery threshold, COD, ETA. */
export function PromoStrip({ store }: { store: StoreStatus | null | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!store) return null;
  const items: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }[] = [];
  if (store.fees.free_delivery_above > 0)
    items.push({
      icon: 'truck-fast-outline',
      label: t('home.freeDeliveryAbove', { amount: formatPrice(store.fees.free_delivery_above) }),
    });
  items.push({ icon: 'cash', label: t('home.codAvailable') });
  if (store.is_open)
    items.push({ icon: 'clock-fast', label: t('home.etaChip', { minutes: store.eta_minutes }) });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
    >
      {items.map((it) => (
        <View
          key={it.label}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            paddingVertical: 6,
            borderRadius: radius.full,
            backgroundColor: colors.primarySoft,
          }}
        >
          <MaterialCommunityIcons name={it.icon} size={16} color={colors.primary} />
          <Text variant="caption" weight="semibold" color="primary">
            {it.label}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
