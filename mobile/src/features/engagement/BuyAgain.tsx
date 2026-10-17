import { router } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useIsLoggedIn } from '@/features/auth/store';
import { CartBar } from '@/features/cart/CartBar';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { ProductGrid } from '@/features/catalog/components/ProductGrid';
import { useLocalize, type LocalizedString } from '@/i18n/localize';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, ScreenHeader, Text } from '@/ui';

import { useBuyAgain } from './hooks';

/** Home section: "Buy again" rail from past delivered orders. Hidden for guests and new users. */
export function BuyAgainRail({ title }: { title: LocalizedString | null }) {
  const { t } = useTranslation();
  const l = useLocalize();
  const loggedIn = useIsLoggedIn();
  const q = useBuyAgain(12);
  const items = q.data ?? [];
  if (!loggedIn || items.length === 0) return null;
  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.lg,
        }}
      >
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {l(title) || t('buyAgain.title')}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => router.push('/buy-again')} hitSlop={8}>
          <Text weight="semibold" color="primary">
            {t('buyAgain.seeAll')}
          </Text>
        </Pressable>
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(p) => String(p.variant.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
        renderItem={({ item }) => <ProductCard product={item} width={156} />}
      />
    </View>
  );
}

export function BuyAgainScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useBuyAgain(50);
  const items = q.data ?? [];
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={t('buyAgain.title')} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {!q.isPending && !q.isError && items.length === 0 ? (
          <EmptyState
            icon="history"
            title={t('buyAgain.emptyTitle')}
            message={t('buyAgain.emptyBody')}
          />
        ) : (
          <ProductGrid
            products={items}
            loading={q.isPending}
            error={q.isError ? q.error : null}
            onRetry={() => void q.refetch()}
            refreshing={q.isRefetching}
            onRefresh={() => void q.refetch()}
          />
        )}
      </View>
      <CartBar />
    </SafeAreaView>
  );
}
