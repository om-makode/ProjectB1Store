import { router } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import {
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { summarize, useGuestCart } from '@/features/cart/store';
import { RatingSummary, WishlistButton } from '@/features/engagement/components';
import { ReviewsPreview } from '@/features/engagement/ReviewsPreview';
import { shareProduct } from '@/features/engagement/share';
import { useCartControl } from '@/features/cart/useCartControl';
import { RelatedRail } from '@/features/search/components/RelatedRail';
import { NotifyMeButton } from '@/features/stock-alerts/NotifyMeButton';
import { useLocalize } from '@/i18n/localize';
import { formatPrice } from '@/lib/format';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Badge,
  Card,
  IconButton,
  EmptyState,
  ErrorState,
  OfflineBanner,
  PriceTag,
  ScreenHeader,
  showToast,
  Skeleton,
  Stepper,
  StickyBottomBar,
  Text,
  useContentWidth,
  useIsWide,
  VegMark,
} from '@/ui';

import { formatAttribute, effectiveFields } from '../attributes';
import { ProductImage } from '../components/ProductImage';
import { useProduct } from '../hooks';
import { mergeOffer, useLiveCatalog } from '../live';
import { openCategory, useCategoryIcon, useCategoryTint } from '../navigation';
import type { ProductDetail, ProductDetailVariant } from '../types';

export function ProductScreen({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useProduct(slug);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader right={q.data ? <ProductHeaderActions data={q.data} /> : null} />
      <OfflineBanner />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {q.isPending ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="100%" height={280} />
            <Skeleton width="70%" height={24} />
            <Skeleton width="40%" height={18} />
          </View>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <EmptyState
            icon="package-variant-remove"
            title={t('catalog.productNotFound')}
            message={t('catalog.productNotFoundMessage')}
          />
        ) : (
          <ProductBody data={q.data} />
        )}
      </View>
    </SafeAreaView>
  );
}

function ProductBody({ data }: { data: ProductDetail }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const { width } = useWindowDimensions();
  const tintFor = useCategoryTint();
  const { product, variants } = data;
  const tint = tintFor(product.category_id);
  const icon = (useCategoryIcon()(product.category_id) ?? undefined) as ComponentProps<
    typeof ProductImage
  >['icon'];
  const name = l(product.name);

  // Live stock/price for every variant.
  const inventory = useLiveCatalog((s) => s.inventory);
  const livePatches = useLiveCatalog((s) => s.variants);
  const live = useMemo(
    () => variants.map((v) => mergeOffer(v, inventory[v.id], livePatches[v.id])),
    [variants, inventory, livePatches],
  );

  const initial =
    live.find((v) => v.is_default && v.available_qty > 0) ??
    live.find((v) => v.available_qty > 0) ??
    live[0];
  const [variantId, setVariantId] = useState(initial?.id);
  const variant = live.find((v) => v.id === variantId) ?? initial;

  const images = data.images.filter((i) => !i.variant_id || i.variant_id === variant?.id);
  const fields = effectiveFields(data.attribute_fields);
  const highlights = fields
    .map((f) => ({ f, value: formatAttribute(f, product.attributes[f.key], l, t) }))
    .filter((x) => x.value);

  const wide = useIsWide(900);
  const content = useContentWidth();
  const galleryWidth = wide ? Math.min(content * 0.45, 520) : width;

  const gallery = (
    <Gallery
      images={images.map((i) => i.path)}
      name={name}
      tint={tint}
      icon={icon}
      width={galleryWidth}
    />
  );

  const details = (
    <>
      {/* Title, price, ADD */}
      <Card style={{ marginHorizontal: spacing.md, gap: spacing.sm }}>
        <Pressable onPress={() => openCategory(data.category.slug)} accessibilityRole="link">
          <Text variant="caption" weight="semibold" style={{ color: tint ?? colors.primary }}>
            {l(data.category.name)}
          </Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 6 }}>
            <VegMark isVeg={product.is_veg} />
          </View>
          <Text variant="h2" style={{ flex: 1 }} accessibilityRole="header">
            {name}
          </Text>
        </View>
        {data.brand ? <Text color="textMuted">{l(data.brand.name)}</Text> : null}
        <RatingSummary
          avg={Number(data.product.rating_avg ?? 0)}
          count={data.product.rating_count ?? 0}
          onPress={() =>
            router.push({ pathname: '/product/[slug]/reviews', params: { slug: product.slug } })
          }
        />
        {variant ? <VariantBuyRow product={data} variant={variant} /> : null}
      </Card>

      {/* Variant picker */}
      {live.length > 1 ? (
        <Card style={{ marginHorizontal: spacing.md, gap: spacing.sm }}>
          <Text variant="title">{t('catalog.selectUnit')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {live.map((v) => (
              <VariantOption
                key={v.id}
                v={v}
                selected={v.id === variant?.id}
                onPress={() => setVariantId(v.id)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {/* Highlights from the category's attribute schema */}
      {highlights.length > 0 ? (
        <Card style={{ marginHorizontal: spacing.md, gap: spacing.sm }}>
          <Text variant="title" weight="bold">
            {t('catalog.highlights')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md }}>
            {highlights.map(({ f, value }) => (
              <View key={f.key} style={{ width: '50%', paddingRight: spacing.sm }}>
                <InfoRow label={l(f.label)} value={value} />
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {product.description && l(product.description) ? (
        <Card style={{ marginHorizontal: spacing.md, gap: spacing.sm }}>
          <Text variant="title">{t('catalog.description')}</Text>
          <Text>{l(product.description)}</Text>
        </Card>
      ) : null}

      {(product.rating_count ?? 0) > 0 ? (
        <ReviewsPreview productId={product.id} slug={product.slug} />
      ) : null}

      <RelatedRail
        key={`together-${product.id}`}
        productId={product.id}
        kind="together"
        title={t('search.together')}
      />
      <RelatedRail
        key={`similar-${product.id}`}
        productId={product.id}
        kind="similar"
        title={t('search.similar')}
      />

      {/* Legal Metrology / E-Commerce Rules: mandatory declarations */}
      <Card style={{ marginHorizontal: spacing.md, gap: spacing.sm }}>
        <Text variant="title">{t('catalog.productInfo')}</Text>
        {variant ? (
          <>
            <InfoRow label={t('catalog.mrpInclTaxes')} value={formatPrice(variant.mrp)} />
            <InfoRow
              label={t('catalog.netQty')}
              value={`${variant.net_quantity} ${variant.unit}`}
            />
          </>
        ) : null}
        {product.manufacturer ? (
          <InfoRow
            label={t('catalog.manufacturer')}
            value={[product.manufacturer.name, product.manufacturer.address]
              .filter(Boolean)
              .join(', ')}
          />
        ) : null}
        <InfoRow label={t('catalog.countryOfOrigin')} value={product.country_of_origin} />
        {product.shelf_life ? (
          <InfoRow label={t('catalog.shelfLife')} value={product.shelf_life} />
        ) : null}
        {data.seller ? (
          <>
            <InfoRow
              label={t('catalog.seller')}
              value={`${l(data.seller.name)}, ${l(data.seller.address)}`}
            />
            {data.seller.fssai_license ? (
              <InfoRow label={t('catalog.fssai')} value={data.seller.fssai_license} />
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {wide ? (
          <View
            style={{
              flexDirection: 'row',
              gap: spacing.lg,
              width: '100%',
              maxWidth: layout.contentMax,
              alignSelf: 'center',
              padding: spacing.lg,
              alignItems: 'flex-start',
            }}
          >
            <View style={{ width: galleryWidth }}>{gallery}</View>
            <View style={{ flex: 1, gap: spacing.md }}>{details}</View>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {gallery}
            {details}
          </View>
        )}
      </ScrollView>
      {variant ? <BuyBar product={data} variant={variant} /> : null}
    </View>
  );
}

/** Swipeable photos with page dots; a large category-icon tile when there are none yet. */
function Gallery({
  images,
  name,
  tint,
  icon,
  width,
}: {
  images: string[];
  name: string;
  tint: string | null;
  icon: ComponentProps<typeof ProductImage>['icon'];
  width: number;
}) {
  const { colors } = useTheme();
  const [page, setPage] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        paddingBottom: spacing.md,
        borderRadius: radius.lg,
        overflow: 'hidden',
      }}
    >
      {images.length > 0 ? (
        <>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
          >
            {images.map((path) => (
              <View key={path} style={{ width, padding: spacing.xl }}>
                <ProductImage path={path} name={name} tint={tint} icon={icon} />
              </View>
            ))}
          </ScrollView>
          {images.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {images.map((p, i) => (
                <View
                  key={p}
                  style={{
                    width: i === page ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === page ? colors.primary : colors.border,
                  }}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ padding: spacing.xl, alignItems: 'center' }}>
          <ProductImage
            path={null}
            name={name}
            tint={tint}
            icon={icon}
            size={Math.min(width * 0.6, 280)}
          />
        </View>
      )}
    </View>
  );
}

/** Sticky bottom bar: unit, price/MRP/% off on the left, ADD or stepper, then "View cart". */
function BuyBar({ product, variant }: { product: ProductDetail; variant: ProductDetailVariant }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const lines = useGuestCart((s) => s.lines);
  const { count } = useMemo(() => summarize(lines), [lines]);
  const cart = useCartControl({
    productId: product.product.id,
    slug: product.product.slug,
    name: product.product.name,
    isVeg: product.product.is_veg,
    thumbPath: product.images[0]?.thumb_path ?? product.images[0]?.path ?? null,
    variant,
  });
  const out = variant.available_qty <= 0;
  return (
    <StickyBottomBar max={layout.contentMax}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {l(variant.label)}
        </Text>
        <PriceTag
          price={variant.price}
          mrp={variant.mrp > variant.price ? variant.mrp : null}
          size="md"
        />
        <Text variant="caption" color="textMuted">
          {t('catalog.inclTaxes')}
        </Text>
      </View>
      {out && cart.quantity === 0 ? (
        <NotifyMeButton variantId={variant.id} size="md" />
      ) : (
        <Stepper {...cart} size="md" />
      )}
      {count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('cart.viewCart')}, ${t('cart.items', { count })}`}
          onPress={() => router.push('/cart')}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: spacing.md,
            borderRadius: radius.md,
            justifyContent: 'center',
            backgroundColor: colors.primary,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text weight="bold" color="primaryText">
            {t('cart.viewCart')}
          </Text>
          <Text variant="caption" color="primaryText" style={{ opacity: 0.9 }}>
            {t('cart.items', { count })}
          </Text>
        </Pressable>
      ) : null}
    </StickyBottomBar>
  );
}

/** Price block in the title card; the ADD button lives in the sticky bottom bar. */
function VariantBuyRow({ variant }: { product: ProductDetail; variant: ProductDetailVariant }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const out = variant.available_qty <= 0;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text color="textMuted">{l(variant.label)}</Text>
      <View style={{ gap: 2 }}>
        <PriceTag
          price={variant.price}
          mrp={variant.mrp > variant.price ? variant.mrp : null}
          size="md"
        />
        <Text variant="caption" color="textMuted">
          {t('catalog.mrpInclTaxes')}
        </Text>
      </View>
      {out ? (
        <Badge label={t('stock.outOfStock')} tone="danger" />
      ) : variant.low_stock ? (
        <Badge label={t('stock.onlyLeft', { count: variant.available_qty })} tone="warning" />
      ) : null}
    </View>
  );
}

function VariantOption({
  v,
  selected,
  onPress,
}: {
  v: ProductDetailVariant;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const out = v.available_qty <= 0;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: out }}
      accessibilityLabel={`${l(v.label)}, ${formatPrice(v.price)}${out ? `, ${t('stock.outOfStock')}` : ''}`}
      onPress={onPress}
      style={{
        minWidth: 96,
        padding: spacing.sm,
        borderRadius: radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        opacity: out ? 0.55 : 1,
        gap: 2,
      }}
    >
      {v.discount_pct > 0 ? (
        <Text variant="caption" weight="bold" color="discount">
          {t('price.off', { percent: v.discount_pct })}
        </Text>
      ) : null}
      <Text weight="semibold">{l(v.label)}</Text>
      <Text variant="caption">{formatPrice(v.price)}</Text>
      {out ? (
        <Text variant="caption" color="danger">
          {t('stock.outOfStock')}
        </Text>
      ) : null}
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text weight="semibold">{value}</Text>
    </View>
  );
}

function ProductHeaderActions({ data }: { data: ProductDetail }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const v = data.variants.find((x) => x.is_default) ?? data.variants[0];
  const onShare = async () => {
    const r = await shareProduct({
      name: l(data.product.name),
      price: v ? `${formatPrice(v.price)} · ${l(v.label)}` : '',
      slug: data.product.slug,
      title: t('share.title'),
    });
    if (r === 'copied') showToast(t('share.copied'), 'success');
    else if (r === 'failed') showToast(t('share.failed'), 'danger');
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconButton
        icon="share-variant-outline"
        accessibilityLabel={t('share.action')}
        onPress={() => void onShare()}
      />
      <WishlistButton productId={data.product.id} size={22} />
    </View>
  );
}
