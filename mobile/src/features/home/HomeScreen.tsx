import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CartBar } from '@/features/cart/CartBar';
import { HomeSectionView } from '@/features/catalog/components/HomeSections';
import {
  HomeSearchBar,
  PromoStrip,
  StoreHeader,
  useHeaderColors,
} from '@/features/catalog/components/StoreHeader';
import { useHome, useStoreStatus } from '@/features/catalog/hooks';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, ErrorState, MaxWidth, OfflineBanner, Skeleton } from '@/ui';

/** Home: live store status, search, then the admin-arranged sections from get_home(). */
export function HomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const home = useHome();
  const status = useStoreStatus();
  const [refreshing, setRefreshing] = useState(false);
  const store = status.data ?? home.data?.store;
  const header = useHeaderColors(store);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([home.refetch(), status.refetch()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: header.bg }}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <OfflineBanner />
        <ScrollView
          // Header scrolls away; the search bar (child 1) stays pinned like Blinkit.
          stickyHeaderIndices={[1]}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <StoreHeader store={store} loading={home.isPending || status.isPending} />
          <HomeSearchBar store={store} />

          <MaxWidth style={{ gap: spacing.xl, paddingTop: spacing.md }}>
            <PromoStrip store={store} />
            {home.isPending ? (
              <HomeSkeleton />
            ) : home.isError && !home.data ? (
              <ErrorState error={home.error} onRetry={() => void home.refetch()} />
            ) : !home.data?.sections.length ? (
              <EmptyState
                icon="storefront-outline"
                title={t('catalog.noProducts')}
                message={t('catalog.noProductsMessage')}
              />
            ) : (
              home.data.sections.map((s) => <HomeSectionView key={s.id} section={s} />)
            )}
          </MaxWidth>
        </ScrollView>
        <CartBar />
      </View>
    </SafeAreaView>
  );
}

function HomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
      <Skeleton width="100%" height={140} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="23%" height={80} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[0, 1].map((i) => (
          <Skeleton key={i} width="48%" height={220} />
        ))}
      </View>
    </View>
  );
}
