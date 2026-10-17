import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CartBar } from '@/features/cart/CartBar';
import { useLocalize } from '@/i18n/localize';
import { layout, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Chip,
  EmptyState,
  ErrorState,
  OfflineBanner,
  ScreenHeader,
  Sheet,
  Skeleton,
  Text,
  useIsWide,
} from '@/ui';

import { FilterBar } from '@/features/filters/FilterBar';
import { parseFilterConfig, type Filters } from '@/features/filters/filters';
import { FilterSheet } from '@/features/filters/FilterSheet';
import { useFilterOptions } from '@/features/search/hooks';

import { effectiveFields } from '../attributes';
import { ProductGrid } from '../components/ProductGrid';
import { ProductImage } from '../components/ProductImage';
import { useCategoryProducts, useCategoryTree } from '../hooks';
import { SORT_KEYS, type Category, type SortKey } from '../types';

const RAIL = 84;
const RAIL_WIDE = 120;
const NO_FILTERS: Filters = {};

/**
 * ONE screen for every category (Blinkit layout): sub-category rail on the left,
 * product grid on the right. `slug` may be a parent or a sub-category.
 */
export function CategoryScreen({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const { tree, isPending, isError, error, refetch } = useCategoryTree();
  const wide = useIsWide(760);

  const current = tree?.bySlug(slug);
  const parent = current?.parent_id ? tree?.byId(current.parent_id) : current;
  const subs = useMemo(() => (parent && tree ? tree.childrenOf(parent.id) : []), [parent, tree]);

  // Selected shelf: the sub-category itself, or "All" (= parent id) when opened on a parent.
  // Picked shelf resets when the screen is opened on another slug.
  const [picked, setPicked] = useState<{ slug: string; id: number } | null>(null);
  const selectedId = picked?.slug === slug ? picked.id : current?.id;
  const setSelectedId = (id: number) => setPicked({ slug, id });
  const [sort, setSort] = useState<SortKey>('relevance');
  const [sortOpen, setSortOpen] = useState(false);
  // Filters belong to the category that was opened; a new slug starts clean.
  const [filterState, setFilterState] = useState<{ slug: string; f: Filters }>({ slug, f: {} });
  const filters = filterState.slug === slug ? filterState.f : NO_FILTERS;
  const setFilters = (f: Filters) => setFilterState({ slug, f });
  const [filterOpen, setFilterOpen] = useState(false);

  const selected = selectedId !== undefined ? tree?.byId(selectedId) : undefined;
  const filterConfig = useMemo(() => parseFilterConfig(parent?.filters), [parent?.filters]);
  const fields = useMemo(
    () =>
      effectiveFields([
        ...(parent?.attribute_schema?.fields ?? []),
        ...(selected && selected.id !== parent?.id
          ? (selected.attribute_schema?.fields ?? [])
          : []),
      ]),
    [parent, selected],
  );
  const filterOptions = useFilterOptions(selectedId);

  const products = useCategoryProducts(selectedId, sort, filters);
  const items = useMemo(() => products.data?.pages.flatMap((p) => p.items) ?? [], [products.data]);
  const tint = parent?.color ?? null;

  const header = (
    <ScreenHeader
      title={parent ? l(parent.name) : ''}
      tint={tint}
      right={
        <Chip
          label={t(`catalog.sortOptions.${sort}`)}
          icon="sort"
          selected={sort !== 'relevance'}
          onPress={() => setSortOpen(true)}
        />
      }
    />
  );

  if (isPending) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
        {header}
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width="100%" height={200} />
        </View>
      </SafeAreaView>
    );
  }
  if (!parent) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        {isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <EmptyState
            icon="shape-outline"
            title={t('catalog.noProducts')}
            message={t('catalog.noProductsMessage')}
          />
        )}
      </SafeAreaView>
    );
  }

  const rail: Category[] = [
    {
      ...parent,
      name: {
        en: t('catalog.all', { lng: 'en' }),
        mr: t('catalog.all', { lng: 'mr' }),
        hi: t('catalog.all', { lng: 'hi' }),
      },
    },
    ...subs,
  ];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      {header}
      <OfflineBanner />
      <FilterBar
        config={filterConfig}
        fields={fields}
        options={filterOptions.data}
        value={filters}
        onChange={setFilters}
        onOpenSheet={() => setFilterOpen(true)}
        tint={tint}
      />
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: colors.background,
          width: '100%',
          maxWidth: layout.contentMax,
          alignSelf: 'center',
        }}
      >
        {subs.length > 0 ? (
          <ScrollView
            style={{
              width: wide ? RAIL_WIDE : RAIL,
              flexGrow: 0,
              backgroundColor: colors.surface,
              borderRightWidth: 1,
              borderRightColor: colors.hairline,
            }}
            contentContainerStyle={{ paddingVertical: spacing.sm }}
            accessibilityRole="tablist"
          >
            {rail.map((c) => (
              <RailItem
                key={c.id}
                category={c}
                tint={tint ?? colors.primary}
                icon={c.icon ?? parent.icon}
                selected={c.id === selectedId}
                onPress={() => setSelectedId(c.id)}
              />
            ))}
          </ScrollView>
        ) : null}
        <View style={{ flex: 1 }}>
          <ProductGrid
            products={items}
            loading={products.isPending}
            error={products.error}
            onRetry={() => void products.refetch()}
            onEndReached={() => {
              if (products.hasNextPage && !products.isFetchingNextPage)
                void products.fetchNextPage();
            }}
            loadingMore={products.isFetchingNextPage}
            refreshing={products.isRefetching && !products.isFetchingNextPage}
            onRefresh={() => void products.refetch()}
          />
        </View>
      </View>
      <CartBar />

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        config={filterConfig}
        fields={fields}
        options={filterOptions.data}
        value={filters}
        onApply={setFilters}
        tint={tint}
      />

      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title={t('catalog.sortTitle')}>
        <View style={{ gap: spacing.sm }}>
          {SORT_KEYS.map((k) => (
            <Chip
              key={k}
              label={t(`catalog.sortOptions.${k}`)}
              selected={k === sort}
              onPress={() => {
                setSort(k);
                setSortOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function RailItem({
  category,
  selected,
  tint,
  icon,
  onPress,
}: {
  category: Category;
  selected: boolean;
  tint: string;
  icon: string | null;
  onPress: () => void;
}) {
  const l = useLocalize();
  const name = l(category.name);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        gap: 4,
        paddingVertical: spacing.sm,
        paddingHorizontal: 6,
        backgroundColor: selected ? `${tint}14` : pressed ? `${tint}0A` : 'transparent',
      })}
    >
      {/* Active indicator: rounded bar on the rail's right edge (Blinkit-style). */}
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: spacing.sm,
          bottom: spacing.sm,
          width: 4,
          borderTopLeftRadius: 4,
          borderBottomLeftRadius: 4,
          backgroundColor: selected ? tint : 'transparent',
        }}
      />
      <ProductImage
        path={category.image_path}
        name={name}
        tint={tint}
        icon={(icon as IconName | null) ?? undefined}
        size={52}
        rounded={radius.full}
        style={selected ? { borderWidth: 2, borderColor: tint } : undefined}
      />
      <Text
        variant="caption"
        weight={selected ? 'bold' : 'regular'}
        align="center"
        numberOfLines={2}
        style={[{ fontSize: 11, lineHeight: 15 }, selected ? { color: tint } : null]}
      >
        {name}
      </Text>
    </Pressable>
  );
}
