import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useIsLoggedIn } from '@/features/auth/store';
import { openLogin } from '@/features/auth/useRequireLogin';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, EmptyState, ErrorState, Skeleton, Text } from '@/ui';

import { OrderListCard } from './components/OrderListCard';
import { useActiveOrders, usePastOrders } from './hooks';

export function OrdersScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const loggedIn = useIsLoggedIn();
  const active = useActiveOrders();
  const past = usePastOrders();

  // Refetch when the tab comes back into view (Realtime covers changes while it's open).
  useFocusEffect(
    useCallback(() => {
      if (!loggedIn) return;
      void active.refetch();
      void past.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loggedIn]),
  );

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
      }}
    >
      <Text variant="h1" accessibilityRole="header">
        {t('orders.title')}
      </Text>
      {loggedIn ? <NotificationBell /> : null}
    </View>
  );

  if (!loggedIn) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <EmptyState
          icon="receipt-text-outline"
          title={t('orders.loginTitle')}
          message={t('orders.loginBody')}
          action={{ label: t('orders.login'), onPress: () => openLogin('generic') }}
        />
      </SafeAreaView>
    );
  }

  const pastOrders = past.data?.pages.flat() ?? [];
  const activeOrders = active.data ?? [];
  const loading = active.isPending || past.isPending;
  const error = active.error ?? past.error;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={active.isRefetching || past.isRefetching}
            onRefresh={() => {
              void active.refetch();
              void past.refetch();
            }}
          />
        }
      >
        {loading ? (
          <>
            <Skeleton width="100%" height={150} />
            <Skeleton width="100%" height={150} />
          </>
        ) : error && !activeOrders.length && !pastOrders.length ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void active.refetch();
              void past.refetch();
            }}
          />
        ) : !activeOrders.length && !pastOrders.length ? (
          <EmptyState
            icon="receipt-text-outline"
            title={t('orders.empty')}
            message={t('orders.emptyMessage')}
            action={{ label: t('orders.browse'), onPress: () => router.navigate('/') }}
          />
        ) : (
          <>
            {activeOrders.length ? (
              <>
                <Text variant="title" accessibilityRole="header">
                  {t('orders.active')}
                </Text>
                {activeOrders.map((o) => (
                  <OrderListCard key={o.id} order={o} />
                ))}
              </>
            ) : null}
            {pastOrders.length ? (
              <>
                <Text variant="title" accessibilityRole="header">
                  {t('orders.past')}
                </Text>
                {pastOrders.map((o) => (
                  <OrderListCard key={o.id} order={o} />
                ))}
              </>
            ) : null}
            {past.hasNextPage ? (
              <Button
                title={t('orders.loadMore')}
                variant="secondary"
                loading={past.isFetchingNextPage}
                onPress={() => void past.fetchNextPage()}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
