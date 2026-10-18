import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRequireLogin } from '@/features/auth/useRequireLogin';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { IconButton, showToast, Text } from '@/ui';

import { useIsWishlisted, useToggleWishlist, useWishlistIds } from './hooks';

/** Heart in the Home header: opens the wishlist, with a count of saved items. */
export function WishlistHeaderButton({
  pill = false,
  open = true,
}: {
  pill?: boolean;
  open?: boolean;
} = {}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ids = useWishlistIds();
  const count = ids.data?.length ?? 0;

  if (pill) {
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('wishlist.open', { count })}
          onPress={() => router.push('/account/wishlist')}
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
            name={count ? 'heart' : 'heart-outline'}
            size={20}
            color={count ? colors.danger : open ? '#111827' : colors.text}
          />
        </Pressable>
        {count ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 4,
              borderRadius: radius.full,
              backgroundColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: open ? '#F8CB46' : colors.surface,
            }}
          >
            <Text variant="caption" weight="bold" style={{ color: '#FFFFFF', fontSize: 10 }}>
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <IconButton
        icon={count ? 'heart' : 'heart-outline'}
        accessibilityLabel={t('wishlist.open', { count })}
        onPress={() => router.push('/account/wishlist')}
      />
      {count ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: radius.full,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" weight="bold" style={{ color: '#FFFFFF', fontSize: 11 }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Heart on product cards / detail. Logged-out taps open login first. */
export function WishlistButton({
  productId,
  size = 20,
  floating,
}: {
  productId: number;
  size?: number;
  /** Small white circle for placing over a product photo. */
  floating?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const requireLogin = useRequireLogin();
  const on = useIsWishlisted(productId);
  const toggle = useToggleWishlist();

  const press = () => {
    if (!requireLogin('wishlist')) return;
    toggle.mutate(
      { productId, on: !on },
      {
        onSuccess: () => showToast(t(on ? 'wishlist.removed' : 'wishlist.added'), 'info'),
        onError: () => showToast(t('errors.server'), 'danger'),
      },
    );
  };

  return (
    <Pressable
      testID={`wishlist-${productId}`}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={on ? t('wishlist.remove') : t('wishlist.add')}
      hitSlop={8}
      onPress={press}
      style={
        floating
          ? {
              width: size + 12,
              height: size + 12,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              opacity: 0.95,
            }
          : { padding: spacing.sm }
      }
    >
      <MaterialCommunityIcons
        name={on ? 'heart' : 'heart-outline'}
        size={size}
        color={on ? colors.danger : colors.textMuted}
      />
    </Pressable>
  );
}

/** ★★★★☆ 4.2 (38). Hidden when there are no ratings yet. */
export function RatingSummary({
  avg,
  count,
  onPress,
}: {
  avg: number;
  count: number;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <Pressable
      accessibilityRole={onPress ? 'link' : 'text'}
      accessibilityLabel={t('reviews.summaryLabel', { avg: avg.toFixed(1), count })}
      onPress={onPress}
      disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.sm,
          backgroundColor: colors.success,
        }}
      >
        <Text variant="caption" weight="bold" style={{ color: '#fff' }}>
          {avg.toFixed(1)}
        </Text>
        <MaterialCommunityIcons name="star" size={12} color="#fff" />
      </View>
      <Text variant="caption" color="textMuted">
        {t('reviews.count', { count })}
      </Text>
      {onPress ? (
        <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

/** Read-only stars, or tappable 1–5 when `onChange` is given (48dp targets). */
export function Stars({
  value,
  onChange,
  size = 16,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', gap: onChange ? spacing.xs : 1 }}
      accessibilityRole={onChange ? 'adjustable' : 'text'}
      accessibilityLabel={t('reviews.stars', { count: value })}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = (
          <MaterialCommunityIcons
            name={value >= n ? 'star' : value >= n - 0.5 ? 'star-half-full' : 'star-outline'}
            size={size}
            color={value >= n - 0.5 ? colors.warning : colors.border}
          />
        );
        return onChange ? (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={t('reviews.stars', { count: n })}
            accessibilityState={{ selected: value === n }}
            onPress={() => onChange(n)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            {icon}
          </Pressable>
        ) : (
          <View key={n}>{icon}</View>
        );
      })}
    </View>
  );
}
