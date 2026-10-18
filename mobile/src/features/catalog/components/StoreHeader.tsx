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

import type { HeaderThemeKey, StoreStatus } from '../types';
export type { HeaderThemeKey } from '../types';

export type HeaderThemeConfig = {
  key: HeaderThemeKey;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  badgeBg: string;
  badgeIcon: string;
  locationPillBg: string;
  locationPillBorder: string;
  locationTitle: string;
  locationSubtitle: string;
  searchBorder: string;
  searchIcon: string;
};

export const HEADER_THEMES: Record<HeaderThemeKey, HeaderThemeConfig> = {
  emerald: {
    key: 'emerald',
    label: 'Emerald Green',
    bg: '#0C831F',
    fg: '#FFFFFF',
    muted: 'rgba(255, 255, 255, 0.85)',
    badgeBg: '#085C15',
    badgeIcon: '#F8CB46',
    locationPillBg: 'rgba(255, 255, 255, 0.92)',
    locationPillBorder: 'rgba(255, 255, 255, 0.3)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.06)',
    searchIcon: '#0C831F',
  },
  amber: {
    key: 'amber',
    label: 'Sunset Amber',
    bg: '#F59E0B',
    fg: '#111827',
    muted: '#374151',
    badgeBg: '#111827',
    badgeIcon: '#F59E0B',
    locationPillBg: 'rgba(255, 255, 255, 0.78)',
    locationPillBorder: 'rgba(0, 0, 0, 0.08)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.06)',
    searchIcon: '#111827',
  },
  yellow: {
    key: 'yellow',
    label: 'Classic Yellow',
    bg: '#F8CB46',
    fg: '#111827',
    muted: '#374151',
    badgeBg: '#111827',
    badgeIcon: '#F8CB46',
    locationPillBg: 'rgba(255, 255, 255, 0.75)',
    locationPillBorder: 'rgba(0, 0, 0, 0.06)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.06)',
    searchIcon: '#111827',
  },
  purple: {
    key: 'purple',
    label: 'Royal Purple',
    bg: '#5B21B6',
    fg: '#FFFFFF',
    muted: 'rgba(255, 255, 255, 0.85)',
    badgeBg: '#4C1D95',
    badgeIcon: '#FBBF24',
    locationPillBg: 'rgba(255, 255, 255, 0.92)',
    locationPillBorder: 'rgba(255, 255, 255, 0.3)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.06)',
    searchIcon: '#5B21B6',
  },
  navy: {
    key: 'navy',
    label: 'Midnight Navy',
    bg: '#0F172A',
    fg: '#FFFFFF',
    muted: 'rgba(255, 255, 255, 0.85)',
    badgeBg: '#1E293B',
    badgeIcon: '#38BDF8',
    locationPillBg: 'rgba(255, 255, 255, 0.92)',
    locationPillBorder: 'rgba(255, 255, 255, 0.3)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.06)',
    searchIcon: '#0F172A',
  },
  slate: {
    key: 'slate',
    label: 'Clean Slate',
    bg: '#E5E7EB',
    fg: '#111827',
    muted: '#4B5563',
    badgeBg: '#111827',
    badgeIcon: '#10B981',
    locationPillBg: '#FFFFFF',
    locationPillBorder: 'rgba(0, 0, 0, 0.08)',
    locationTitle: '#111827',
    locationSubtitle: '#4B5563',
    searchBorder: 'rgba(0, 0, 0, 0.08)',
    searchIcon: '#111827',
  },
};

/** Header background: configurable theme while open, neutral when closed/paused. */
export function useHeaderColors(store: StoreStatus | null | undefined) {
  const { colors } = useTheme();
  const open = !!store?.is_open;
  const localTheme = useSettings((s) => s.headerTheme);
  const themeKey = (store?.theme_color ?? localTheme ?? 'emerald') as HeaderThemeKey;
  const theme = HEADER_THEMES[themeKey] ?? HEADER_THEMES.emerald;
  return {
    open,
    bg: open ? theme.bg : colors.surfaceAlt,
    fg: open ? theme.fg : colors.text,
    muted: open ? theme.muted : colors.textMuted,
    theme,
  };
}

/** "Delivery in 20 minutes" headline + location + action buttons, like the top of Blinkit's home. */
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
  const { open, bg, fg, muted, theme } = useHeaderColors(store);

  let headline = '';
  let detail = '';
  if (store) {
    if (store.is_open) {
      if (store.eta_minutes > 0) {
        headline = t('home.deliveryIn', { minutes: store.eta_minutes });
      }
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
          paddingTop: spacing.sm,
          paddingBottom: spacing.xs,
          gap: spacing.sm,
        }}
      >
        {/* Top Row: ETA / Store title on Left, Action Pills on Right */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.sm,
          }}
        >
          <View style={{ flex: 1, minHeight: 38, justifyContent: 'center' }}>
            {loading && !store ? (
              <View style={{ gap: spacing.xs }}>
                <Skeleton width="60%" height={26} />
                <Skeleton width="40%" height={14} />
              </View>
            ) : store ? (
              <View accessible accessibilityRole="header">
                {headline ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: open ? theme.badgeBg : 'rgba(0,0,0,0.08)',
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: '#000000',
                        shadowOpacity: 0.12,
                        shadowRadius: 3,
                        shadowOffset: { width: 0, height: 1 },
                        elevation: 1,
                      }}
                    >
                      <MaterialCommunityIcons
                        name={open ? 'lightning-bolt' : 'store-clock-outline'}
                        size={17}
                        color={open ? theme.badgeIcon : fg}
                      />
                    </View>
                    <Text
                      style={{
                        fontSize: 21,
                        fontWeight: '900',
                        color: fg,
                        letterSpacing: -0.4,
                      }}
                      numberOfLines={1}
                    >
                      {headline}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: open ? theme.badgeBg : 'rgba(0,0,0,0.08)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MaterialCommunityIcons
                        name={open ? 'shopping' : 'store-clock-outline'}
                        size={16}
                        color={open ? theme.badgeIcon : fg}
                      />
                    </View>
                    <Text
                      style={{
                        fontSize: 21,
                        fontWeight: '900',
                        color: fg,
                        letterSpacing: -0.4,
                      }}
                      numberOfLines={1}
                    >
                      {open
                        ? l(store.name) || 'NearKart'
                        : !store.accepting
                          ? t('store.paused')
                          : t('store.closed')}
                    </Text>
                  </View>
                )}
                {detail ? (
                  <Text
                    variant="caption"
                    weight="semibold"
                    numberOfLines={1}
                    style={{ color: muted, marginTop: 2, paddingLeft: 35 }}
                  >
                    {detail}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Action pills: Wishlist, Notification Bell, Profile */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <WishlistHeaderButton pill open={open} />
            <NotificationBell pill open={open} />
            <ProfileHeaderButton open={open} />
          </View>
        </View>

        {/* Second Row: Delivery Location Pill */}
        <DeliveryLocationBar color={fg} open={open} theme={theme} />
      </View>
    </View>
  );
}

function ProfileHeaderButton({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('account.title', { defaultValue: 'Account' })}
      onPress={() => router.push('/account')}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: open ? '#FFFFFF' : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
        borderWidth: 1,
        borderColor: open ? 'rgba(0,0,0,0.06)' : colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <MaterialCommunityIcons
        name="account-outline"
        size={20}
        color={open ? '#111827' : colors.text}
      />
    </Pressable>
  );
}

const HINTS = ['milk', 'atta', 'चहा', 'bread', 'साबण', 'eggs'];

/** Search pill that stays pinned at the top while Home scrolls; the hint rotates every 3 s. */
export function HomeSearchBar({ store }: { store: StoreStatus | null | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { bg, open, theme } = useHeaderColors(store);
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % HINTS.length), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <View
      style={{
        backgroundColor: bg,
        paddingTop: spacing.xs,
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.lg,
        borderBottomLeftRadius: 22,
        borderBottomRightRadius: 22,
        shadowColor: '#000000',
        shadowOpacity: open ? 0.08 : 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
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
            minHeight: 48,
            paddingHorizontal: spacing.md + 2,
            borderRadius: radius.xl,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: open ? theme.searchBorder : colors.border,
            opacity: pressed ? 0.95 : 1,
          },
          shadow.sm,
        ]}
      >
        <MaterialCommunityIcons
          name="magnify"
          size={22}
          color={open ? theme.searchIcon : colors.text}
        />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text
            style={{
              fontSize: 14,
              color: colors.textMuted,
              fontWeight: '500',
            }}
            numberOfLines={1}
          >
            {t('home.searchHint', { term: HINTS[i] })}
          </Text>
        </View>
        <View style={{ width: 1, height: 20, backgroundColor: colors.border }} />
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="microphone-outline" size={20} color={colors.primary} />
        </View>
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
  if (store.is_open && store.eta_minutes > 0)
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
