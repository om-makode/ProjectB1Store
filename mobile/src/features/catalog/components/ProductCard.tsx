import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useCartControl } from '@/features/cart/useCartControl';
import { WishlistButton } from '@/features/engagement/components';
import { NotifyMeButton } from '@/features/stock-alerts/NotifyMeButton';
import { useLocalize } from '@/i18n/localize';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { PriceTag, Stepper, Text, VegMark } from '@/ui';

import { useStoreStatus } from '../hooks';
import { useLiveOffer } from '../live';
import { useCategoryIcon } from '../navigation';
import type { ProductCard as ProductCardData } from '../types';
import { ProductImage } from './ProductImage';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

type Props = { product: ProductCardData; width?: number; tint?: string | null };

/** Blinkit-style tile: photo, discount ribbon, name, unit, price/MRP, ADD → − n +. */
export const ProductCard = memo(function ProductCard({ product, width, tint }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const offer = useLiveOffer(product.variant);
  const name = l(product.name);
  const categoryIcon = useCategoryIcon();
  const out = offer.available_qty <= 0;
  const cart = useCartControl({
    productId: product.id,
    slug: product.slug,
    name: product.name,
    isVeg: product.is_veg,
    thumbPath: product.thumb_path,
    variant: offer,
  });

  return (
    <Pressable
      testID={`product-card-${product.slug}`}
      // On web, role "button" renders <button>, and the card contains other buttons (♡, ADD):
      // nested <button>s are invalid HTML. The card stays a plain focusable element there.
      accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
      accessibilityLabel={name}
      onPress={() => router.push({ pathname: '/product/[slug]', params: { slug: product.slug } })}
      style={({ pressed }) => [
        styles.card,
        {
          width,
          backgroundColor: colors.surface,
          borderColor: colors.hairline,
          opacity: pressed ? 0.92 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View>
        <ProductImage
          path={product.thumb_path}
          name={name}
          tint={tint}
          icon={(categoryIcon(product.category_id) as IconName | null) ?? undefined}
          style={{ opacity: out ? 0.45 : 1 }}
        />
        {offer.discount_pct > 0 ? (
          <View style={[styles.ribbon, { backgroundColor: colors.discount }]}>
            <Text
              variant="caption"
              weight="bold"
              style={{ color: '#fff', fontSize: 10, lineHeight: 13 }}
            >
              {t('price.off', { percent: offer.discount_pct })}
            </Text>
          </View>
        ) : null}
        {out ? (
          <View style={[styles.stockTag, { backgroundColor: colors.outOfStock }]}>
            <Text variant="caption" weight="semibold" style={{ color: '#fff' }}>
              {t('stock.outOfStock')}
            </Text>
          </View>
        ) : offer.low_stock ? (
          <View style={[styles.stockTag, { backgroundColor: colors.warning }]}>
            <Text variant="caption" weight="semibold" style={{ color: '#fff' }}>
              {t('stock.onlyLeft', { count: offer.available_qty })}
            </Text>
          </View>
        ) : null}
        <View style={styles.heart}>
          <WishlistButton productId={product.id} size={16} floating />
        </View>
      </View>

      <View style={{ gap: 3, flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <VegMark isVeg={product.is_veg} size={12} />
          <EtaChip />
        </View>
        <Text weight="semibold" numberOfLines={2} style={{ minHeight: 40 }}>
          {name}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {l(offer.label)}
          {product.variant_count > 1
            ? ` · ${t('catalog.options', { count: product.variant_count })}`
            : ''}
        </Text>
        {/* Fixed height so cards in a row line up whether or not they have ratings. */}
        <View style={{ minHeight: 16 }}>
          <CardRating avg={product.rating_avg} count={product.rating_count} />
        </View>
      </View>

      <View style={styles.footer}>
        <View style={{ flexShrink: 1 }}>
          <PriceTag
            price={offer.price}
            mrp={offer.mrp > offer.price ? offer.mrp : null}
            hideDiscount
          />
        </View>
        {out && cart.quantity === 0 ? (
          <NotifyMeButton variantId={offer.id} />
        ) : (
          <Stepper {...cart} />
        )}
      </View>
    </Pressable>
  );
});

/** "⏱ 20 MINS" from the live store ETA (Blinkit-style); hidden while the store is closed. */
function EtaChip() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const store = useStoreStatus();
  if (!store.data?.is_open) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: radius.sm,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      <MaterialCommunityIcons name="timer-outline" size={11} color={colors.text} />
      <Text variant="caption" weight="bold" style={{ fontSize: 10, lineHeight: 13 }}>
        {t('catalog.etaMins', { minutes: store.data.eta_minutes })}
      </Text>
    </View>
  );
}

/** Compact "★ 4.3 (12)" under the name; hidden until a product has reviews. */
function CardRating({ avg, count }: { avg?: number | string | null; count?: number | null }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const n = Number(count ?? 0);
  const value = Number(avg ?? 0);
  if (!n || !value) return null;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
      accessible
      accessibilityLabel={t('reviews.cardRating', { rating: value.toFixed(1), count: n })}
    >
      <MaterialCommunityIcons name="star" size={12} color={colors.warning} />
      <Text variant="caption" weight="semibold">
        {value.toFixed(1)}
      </Text>
      <Text variant="caption" color="textMuted">
        ({n})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  ribbon: {
    position: 'absolute',
    top: 0,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  stockTag: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  heart: { position: 'absolute', top: 2, right: 2 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
});
