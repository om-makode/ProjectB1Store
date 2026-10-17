import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CartBar } from '@/features/cart/CartBar';
import { useLocalize } from '@/i18n/localize';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { EmptyState, ErrorState, OfflineBanner, Skeleton, Text } from '@/ui';

import { CategoryTileView } from '../components/HomeSections';
import { useCategoryTree } from '../hooks';
import { openCategory } from '../navigation';

/** Every category, each with its sub-category tiles (tap a tile → that shelf). */
export function CategoriesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const l = useLocalize();
  const { width } = useWindowDimensions();
  const { tree, isPending, isError, error, refetch, isRefetching } = useCategoryTree();
  const cols = 4;
  const tile = (width - spacing.lg * 2 - spacing.sm * (cols - 1)) / cols;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
      >
        <Text variant="h1" accessibilityRole="header">
          {t('categories.title')}
        </Text>
        {isPending ? (
          <View style={{ gap: spacing.md }}>
            <Skeleton width="50%" height={20} />
            <Skeleton width="100%" height={90} />
            <Skeleton width="50%" height={20} />
            <Skeleton width="100%" height={90} />
          </View>
        ) : isError && !tree ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !tree?.parents.length ? (
          <EmptyState
            icon="view-grid-outline"
            title={t('categories.empty')}
            message={t('categories.emptyMessage')}
          />
        ) : (
          tree.parents.map((parent) => {
            const subs = tree.childrenOf(parent.id);
            return (
              <View key={parent.id} style={{ gap: spacing.md }}>
                <Text
                  variant="title"
                  accessibilityRole="link"
                  onPress={() => openCategory(parent.slug)}
                >
                  {l(parent.name)}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {(subs.length ? subs : [parent]).map((c) => (
                    <CategoryTileView
                      key={c.id}
                      width={tile}
                      category={{
                        ...c,
                        color: c.color ?? parent.color,
                        icon: c.icon ?? parent.icon,
                      }}
                    />
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <CartBar />
    </SafeAreaView>
  );
}
