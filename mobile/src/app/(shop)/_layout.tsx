import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useStoreStatus } from '@/features/catalog/hooks';
import { useCatalogRealtime } from '@/lib/realtime';
import { useSettings } from '@/stores/settings';
import { fontFor } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color as string} size={size} />;
  }
  return TabIcon;
}

export default function ShopTabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const store = useStoreStatus();
  useCatalogRealtime(store.data?.store_id); // live stock & prices for every shop screen

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 13, fontFamily: fontFor('semibold', lang) },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home-variant') }}
      />
      <Tabs.Screen
        name="categories"
        options={{ title: t('tabs.categories'), tabBarIcon: tabIcon('view-grid') }}
      />
      <Tabs.Screen
        name="orders"
        options={{ title: t('tabs.orders'), tabBarIcon: tabIcon('receipt-text') }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: t('tabs.account'), tabBarIcon: tabIcon('account-circle') }}
      />
    </Tabs>
  );
}
