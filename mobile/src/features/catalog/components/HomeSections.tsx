import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { BuyAgainRail } from '@/features/engagement/BuyAgain';
import { useLocalize } from '@/i18n/localize';
import { hasImageFailed, markImageFailed } from '@/lib/imageFailures';
import { catalogImageUrl } from '@/lib/images';
import { radius, shadow, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { SectionHeader, Text, useContentWidth } from '@/ui';

import { useCategoryTree, useCollectionSlugs } from '../hooks';
import { openCategory, openCollection, openLink, useCategoryTint } from '../navigation';
import type {
  Banner,
  CategoryTile,
  CollectionTile,
  HomeSection,
  ProductCard as Card,
} from '../types';
import { ProductCard } from './ProductCard';
import { ProductImage } from './ProductImage';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const BANNER_COLORS = ['#0C831F', '#7C3AED', '#E8590C', '#0B7285', '#C2255C'];
const BANNER_ICONS: Record<string, IconName> = {
  category: 'basket-outline',
  collection: 'gift-outline',
  product: 'tag-heart-outline',
  search: 'magnify',
};
const AUTO_ADVANCE_MS = 4000;

export function HomeSectionView({ section }: { section: HomeSection }) {
  switch (section.type) {
    case 'banner_carousel':
      return <BannerCarousel banners={section.items} />;
    case 'category_grid':
      return <CategoryGrid title={section.title} items={section.items} />;
    case 'product_rail':
      return <ProductRail title={section.title} items={section.items} config={section.config} />;
    case 'collection_rail':
      return <CollectionRail title={section.title} items={section.items} />;
    case 'buy_again':
      return <BuyAgainRail title={section.title} />;
    default:
      return null;
  }
}

/** Full-width cards with a peek of the next one, auto-advancing, with page dots. */
function BannerCarousel({ banners }: { banners: Banner[] }) {
  const { colors } = useTheme();
  const l = useLocalize();
  const content = useContentWidth();
  const reduceMotion = useReducedMotion();
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const touching = useRef(false);

  // Wide screens show 2 banners side by side; phones show one with a peek of the next.
  const perView = content >= 900 ? 2 : 1;
  const peek = perView === 1 && banners.length > 1 ? spacing.xl : 0;
  const w = (content - spacing.lg * 2 - spacing.md * (perView - 1) - peek) / perView;
  const step = w + spacing.md;
  const pages = Math.max(1, banners.length - perView + 1);

  useEffect(() => {
    if (reduceMotion || pages <= 1) return;
    const id = setInterval(() => {
      if (touching.current) return;
      setIndex((i) => {
        const next = (i + 1) % pages;
        ref.current?.scrollTo({ x: next * step, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [pages, step, reduceMotion]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / step);
    if (i !== index) setIndex(Math.max(0, Math.min(pages - 1, i)));
  };

  if (!banners.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={32}
        onTouchStart={() => (touching.current = true)}
        onTouchEnd={() => (touching.current = false)}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
      >
        {banners.map((b, i) => (
          <BannerCard
            key={b.id}
            banner={b}
            width={w}
            color={BANNER_COLORS[i % BANNER_COLORS.length]!}
            title={l(b.title)}
          />
        ))}
      </ScrollView>
      {pages > 1 ? (
        <View
          style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {Array.from({ length: pages }, (_, i) => (
            <View
              key={i}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? colors.primary : colors.border,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BannerCard({
  banner,
  width,
  color,
  title,
}: {
  banner: Banner;
  width: number;
  color: string;
  title: string;
}) {
  const { t } = useTranslation();
  const [, setFailedTick] = useState(0);
  const url = catalogImageUrl(banner.image_path);
  const failed = hasImageFailed(url);
  const height = Math.round(width * 0.45);
  return (
    <Pressable
      accessibilityRole={Platform.OS === 'web' ? 'link' : 'button'}
      accessibilityLabel={title}
      onPress={() => openLink(banner.link)}
      style={({ pressed }) => [
        {
          width,
          height,
          borderRadius: radius.xl,
          overflow: 'hidden',
          backgroundColor: color,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
        shadow.md,
      ]}
    >
      {url && !failed ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          onError={() => {
            markImageFailed(url);
            setFailedTick((n) => n + 1);
          }}
        />
      ) : (
        // No image uploaded yet: a designed banner (two-tone decor, icon, title, call to action).
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'flex-end' }}>
          <View
            style={[styles.decor, { width: width * 0.62, right: -width * 0.14, top: -width * 0.2 }]}
          />
          <View
            style={[
              styles.decor,
              { width: width * 0.32, right: width * 0.1, bottom: -width * 0.16, opacity: 0.6 },
            ]}
          />
          <View style={styles.iconBubble}>
            <MaterialCommunityIcons
              name={BANNER_ICONS[banner.link?.type ?? 'search'] ?? 'basket-outline'}
              size={Math.min(width * 0.12, 48)}
              color="#FFFFFF"
            />
          </View>
          <View style={{ gap: spacing.sm, maxWidth: '70%' }}>
            <Text variant="h2" weight="bold" style={{ color: '#fff' }} numberOfLines={2}>
              {title}
            </Text>
            <View style={styles.cta}>
              <Text variant="caption" weight="bold" style={{ color }}>
                {t('catalog.shopNow')}
              </Text>
              <MaterialCommunityIcons name="arrow-right" size={14} color={color} />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function CategoryGrid({ title, items }: { title: HomeSection['title']; items: CategoryTile[] }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const content = useContentWidth();
  // 4 per row on phones, more on tablets/desktop so tiles don't become huge.
  const cols = content < 600 ? 4 : content < 900 ? 6 : 8;
  const tile = (content - spacing.lg * 2 - spacing.sm * (cols - 1)) / cols;
  return (
    <View style={{ gap: spacing.md }}>
      <SectionHeader title={l(title) || t('catalog.shopByCategory')} />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          rowGap: spacing.md,
          columnGap: spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        {items.map((c) => (
          <CategoryTileView key={c.id} category={c} width={tile} />
        ))}
      </View>
    </View>
  );
}

export function CategoryTileView({ category, width }: { category: CategoryTile; width: number }) {
  const l = useLocalize();
  const name = l(category.name);
  return (
    <Pressable
      accessibilityRole={Platform.OS === 'web' ? 'link' : 'button'}
      accessibilityLabel={name}
      onPress={() => openCategory(category.slug)}
      style={({ pressed }) => ({
        width,
        gap: spacing.xs,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <ProductImage
        path={category.image_path}
        name={name}
        icon={(category.icon as IconName | null) ?? undefined}
        tint={category.color}
        rounded={radius.lg}
      />
      <Text variant="caption" weight="semibold" align="center" numberOfLines={2}>
        {name}
      </Text>
    </Pressable>
  );
}

function ProductRail({
  title,
  items,
  config,
}: {
  title: HomeSection['title'];
  items: Card[];
  config: Record<string, unknown>;
}) {
  const l = useLocalize();
  const tint = useCategoryTint();
  const { tree } = useCategoryTree();
  const collectionSlugs = useCollectionSlugs();

  // "See all" goes to the rail's source: its collection or its category.
  let seeAll: (() => void) | undefined;
  const collectionId = Number(config.collection_id);
  const categoryId = Number(config.category_id);
  if (collectionId && collectionSlugs.has(collectionId)) {
    const slug = collectionSlugs.get(collectionId)!;
    seeAll = () => openCollection(slug);
  } else if (categoryId && tree?.byId(categoryId)) {
    const slug = tree.byId(categoryId)!.slug;
    seeAll = () => openCategory(slug);
  }

  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.md }}>
      <SectionHeader title={l(title)} onSeeAll={seeAll} />
      <FlatList
        horizontal
        data={items}
        keyExtractor={(p) => String(p.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        renderItem={({ item }) => (
          <ProductCard product={item} width={160} tint={tint(item.category_id)} />
        )}
      />
    </View>
  );
}

function CollectionRail({
  title,
  items,
}: {
  title: HomeSection['title'];
  items: CollectionTile[];
}) {
  const l = useLocalize();
  if (!items.length) return null;
  return (
    <View style={{ gap: spacing.md }}>
      <SectionHeader title={l(title)} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
      >
        {items.map((c, i) => {
          const color = BANNER_COLORS[(i + 2) % BANNER_COLORS.length]!;
          return (
            <Pressable
              key={c.id}
              accessibilityRole={Platform.OS === 'web' ? 'link' : 'button'}
              accessibilityLabel={l(c.title)}
              onPress={() => openCollection(c.slug)}
              style={({ pressed }) => [
                {
                  width: 176,
                  height: 104,
                  padding: spacing.md,
                  justifyContent: 'space-between',
                  borderRadius: radius.lg,
                  backgroundColor: `${color}18`,
                  borderWidth: 1,
                  borderColor: `${color}33`,
                  overflow: 'hidden',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <MaterialCommunityIcons name="gift-outline" size={26} color={color} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text weight="bold" numberOfLines={2} style={{ flex: 1 }}>
                  {l(c.title)}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={color} />
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  decor: {
    position: 'absolute',
    aspectRatio: 1,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  iconBubble: {
    position: 'absolute',
    right: spacing.lg,
    top: spacing.lg,
    padding: spacing.sm,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});
