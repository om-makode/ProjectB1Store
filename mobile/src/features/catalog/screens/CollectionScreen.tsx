import { useMemo } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CartBar } from '@/features/cart/CartBar';
import { useLocalize } from '@/i18n/localize';
import { useTheme } from '@/theme/useTheme';
import { OfflineBanner, ScreenHeader } from '@/ui';

import { ProductGrid } from '../components/ProductGrid';
import { useCollectionProducts } from '../hooks';

/** Admin-curated collection ("Bestsellers", "Diwali specials"). */
export function CollectionScreen({ slug }: { slug: string }) {
  const { colors } = useTheme();
  const l = useLocalize();
  const q = useCollectionProducts(slug);
  const pages = q.data?.pages;
  const items = useMemo(() => (pages ?? []).flatMap((p) => p?.items ?? []), [pages]);
  const title = pages?.[0]?.collection ? l(pages[0].collection.title) : '';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={title} />
      <OfflineBanner />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ProductGrid
          products={items}
          loading={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          loadingMore={q.isFetchingNextPage}
          refreshing={q.isRefetching && !q.isFetchingNextPage}
          onRefresh={() => void q.refetch()}
        />
      </View>
      <CartBar />
    </SafeAreaView>
  );
}
