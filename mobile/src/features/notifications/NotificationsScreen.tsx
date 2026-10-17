import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useLocalize } from '@/i18n/localize';
import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/stores/settings';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, EmptyState, ErrorState, ScreenHeader, Skeleton, Text } from '@/ui';

import { notificationHref, type NotificationRow } from './api';
import { useMarkRead, useNotifications, useUnreadCount } from './hooks';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
const ICONS: Record<string, IconName> = {
  order_status: 'receipt-text-outline',
  order_items_changed: 'basket-remove-outline',
  back_in_stock: 'bell-ring-outline',
  issue_update: 'message-reply-text-outline',
  refund_update: 'cash-refund',
  price_drop: 'tag-outline',
  campaign: 'sale',
  review_prompt: 'star-outline',
};

export function NotificationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const l = useLocalize();
  const q = useNotifications();
  const unread = useUnreadCount();
  const markRead = useMarkRead();

  useFocusEffect(
    useCallback(() => {
      void q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const open = (n: NotificationRow) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const href = notificationHref(n.data);
    if (href) router.push(href as Href);
  };

  const items = q.data?.pages.flat() ?? [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        title={t('notifications.title')}
        right={
          unread.data ? (
            <Button
              title={t('notifications.markAll')}
              variant="ghost"
              onPress={() => markRead.mutate(undefined)}
              loading={markRead.isPending}
            />
          ) : null
        }
      />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {q.isPending ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Skeleton width="100%" height={72} />
            <Skeleton width="100%" height={72} />
            <Skeleton width="100%" height={72} />
          </View>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(n) => String(n.id)}
            contentContainerStyle={{ paddingVertical: spacing.sm }}
            refreshControl={
              <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
            }
            onEndReached={() => {
              if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
            }}
            ListEmptyComponent={
              <EmptyState
                icon="bell-outline"
                title={t('notifications.empty')}
                message={t('notifications.emptyMessage')}
              />
            }
            renderItem={({ item: n }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => open(n)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: spacing.md,
                  padding: spacing.lg,
                  backgroundColor: n.read_at ? colors.background : colors.surface,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <MaterialCommunityIcons
                  name={ICONS[n.type] ?? 'bell-outline'}
                  size={24}
                  color={n.read_at ? colors.textMuted : colors.primary}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight={n.read_at ? 'regular' : 'semibold'}>{l(n.title)}</Text>
                  <Text color="textMuted">{l(n.body)}</Text>
                  <Text variant="caption" color="textMuted">
                    {formatDateTime(n.created_at, lang)}
                  </Text>
                </View>
                {!n.read_at ? (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      marginTop: 8,
                      backgroundColor: colors.primary,
                    }}
                  />
                ) : null}
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
