import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { openLogin } from '@/features/auth/useRequireLogin';
import { useIsLoggedIn } from '@/features/auth/store';
import { CartBar } from '@/features/cart/CartBar';
import { ProductGrid } from '@/features/catalog/components/ProductGrid';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, ErrorState, ScreenHeader, Skeleton } from '@/ui';

import { useWishlistCards } from './hooks';

export function WishlistScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const loggedIn = useIsLoggedIn();
  const { ids, cards } = useWishlistCards();
  const items = cards.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={t('wishlist.title')} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {!loggedIn ? (
          <EmptyState
            icon="heart-outline"
            title={t('wishlist.loginTitle')}
            message={t('wishlist.loginBody')}
            action={{ label: t('account.login'), onPress: () => openLogin('wishlist') }}
          />
        ) : ids.isPending || (cards.isPending && (ids.data?.length ?? 0) > 0) ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="100%" height={220} />
          </View>
        ) : ids.isError || cards.isError ? (
          <ErrorState
            error={ids.error ?? cards.error}
            onRetry={() => void Promise.all([ids.refetch(), cards.refetch()])}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="heart-plus-outline"
            title={t('wishlist.emptyTitle')}
            message={t('wishlist.emptyBody')}
            action={{ label: t('wishlist.browse'), onPress: () => router.replace('/') }}
          />
        ) : (
          <ProductGrid
            products={items}
            loading={false}
            error={null}
            onRetry={() => void cards.refetch()}
            refreshing={cards.isRefetching}
            onRefresh={() => void ids.refetch()}
          />
        )}
      </View>
      <CartBar />
    </SafeAreaView>
  );
}
