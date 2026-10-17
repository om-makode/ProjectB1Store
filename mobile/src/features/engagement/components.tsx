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
export function WishlistHeaderButton() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ids = useWishlistIds();
  const count = ids.data?.length ?? 0;

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
