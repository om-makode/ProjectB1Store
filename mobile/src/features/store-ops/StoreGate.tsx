import { router, usePathname, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Badge, EmptyState, IconButton, Skeleton, Text } from '@/ui';

import { useUnsavedChanges } from '@/lib/useUnsavedChanges';

import { useOpenIssues, useStaffAccess } from './hooks';

/** Role guard for every store/ route: staff and admin only (the RPCs check it again). */
export function StoreGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const access = useStaffAccess();
  if (access === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
        <Skeleton width="100%" height={48} />
        <Skeleton width="100%" height={120} />
      </SafeAreaView>
    );
  }
  if (access === 'denied') {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="store-off-outline"
          title={t('storeOps.denied')}
          message={t('storeOps.deniedBody')}
          action={{ label: t('storeOps.backToShop'), onPress: () => router.replace('/') }}
        />
      </SafeAreaView>
    );
  }
  return <>{children}</>;
}

const TABS: { href: Href; path: string; key: 'board' | 'stock' | 'issues' | 'store' }[] = [
  { href: '/store', path: '/store', key: 'board' },
  { href: '/store/stock', path: '/store/stock', key: 'stock' },
  { href: '/store/issues', path: '/store/issues', key: 'issues' },
  { href: '/store/settings', path: '/store/settings', key: 'store' },
];

/** Top bar for Store mode: works the same on a phone, a tablet and the counter laptop. */
export function StoreNav({
  right,
  hasUnsavedChanges = false,
}: {
  right?: ReactNode;
  hasUnsavedChanges?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const pathname = usePathname();
  const issues = useOpenIssues();
  const openIssues = issues.data?.length ?? 0;
  const { promptDiscard } = useUnsavedChanges(hasUnsavedChanges);

  const confirmNav = (nav: () => void) => {
    if (!hasUnsavedChanges) {
      nav();
      return;
    }
    void promptDiscard().then((ok) => {
      if (ok) nav();
    });
  };

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: spacing.sm }}>
        <IconButton
          icon="arrow-left"
          accessibilityLabel={t('storeOps.backToShop')}
          onPress={() => confirmNav(() => router.replace('/account'))}
        />
        <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
          {t('storeOps.title')}
        </Text>
        {right}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
          paddingBottom: spacing.sm,
        }}
      >
        {TABS.map((tab) => {
          const active = pathname === tab.path;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => confirmNav(() => router.replace(tab.href))}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                paddingHorizontal: spacing.lg,
                minHeight: 40,
                borderRadius: radius.full,
                backgroundColor: active ? colors.primary : colors.surfaceAlt,
              }}
            >
              <Text weight="semibold" color={active ? 'primaryText' : 'text'}>
                {t(`storeOps.menu.${tab.key}`)}
              </Text>
              {tab.key === 'issues' && openIssues > 0 ? (
                <Badge label={String(openIssues)} tone="danger" />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
