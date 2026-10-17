import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { ProductImage } from '@/features/catalog/components/ProductImage';
import { useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { layout, radius, shadow, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Text } from '@/ui';

import { summarize, useGuestCart } from './store';

/** Floating "[thumbs] 3 items · ₹245   View cart ›" bar shown on browsing screens. */
export function CartBar() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const reduceMotion = useReducedMotion();
  const lines = useGuestCart((s) => s.lines);
  const { count, total, mrpTotal } = useMemo(() => summarize(lines), [lines]);
  // Most recently added first (object insertion order), up to 3 thumbnails.
  const thumbs = useMemo(() => Object.values(lines).slice(-3).reverse(), [lines]);
  if (count === 0) return null;
  const saved = mrpTotal - total;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <Pressable
        testID="cart-bar"
        accessibilityRole="button"
        accessibilityLabel={`${t('cart.items', { count })}, ${formatPrice(total)}. ${t('cart.viewCart')}`}
        onPress={() => router.push('/cart')}
        style={({ pressed }) => [
          styles.bar,
          { backgroundColor: colors.primary, opacity: pressed ? 0.94 : 1 },
          shadow.lg,
        ]}
      >
        <View style={{ flexDirection: 'row' }}>
          {thumbs.map((line, i) => (
            <View
              key={line.variantId}
              style={{
                marginLeft: i === 0 ? 0 : -14,
                borderRadius: radius.md,
                borderWidth: 2,
                borderColor: colors.primary,
                backgroundColor: colors.surface,
              }}
            >
              <ProductImage
                path={line.thumbPath}
                name={l(line.name)}
                size={34}
                rounded={radius.sm}
              />
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="bold" color="primaryText">
            {t('cart.items', { count })} · {formatPrice(total)}
          </Text>
          {saved > 0 ? (
            <Text variant="caption" color="primaryText" style={{ opacity: 0.9 }}>
              {t('cart.savings', { amount: formatPrice(saved) })}
            </Text>
          ) : null}
        </View>
        <Text weight="bold" color="primaryText">
          {t('cart.viewCart')}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={22} color={colors.primaryText} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: layout.cartBarMax,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
});
