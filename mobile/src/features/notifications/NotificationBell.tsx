import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useIsLoggedIn } from '@/features/auth/store';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { IconButton, Text } from '@/ui';

import { useUnreadCount } from './hooks';

/** Bell with an unread badge; hidden for guests. */
export function NotificationBell({
  pill = false,
  open = true,
}: {
  pill?: boolean;
  open?: boolean;
} = {}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const loggedIn = useIsLoggedIn();
  const unread = useUnreadCount();
  if (!loggedIn) return null;
  const count = unread.data ?? 0;

  if (pill) {
    return (
      <View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notifications.open', { count })}
          onPress={() => router.push('/account/notifications')}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 19,
            backgroundColor: open ? '#FFFFFF' : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000000',
            shadowOpacity: 0.08,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
            borderWidth: 1,
            borderColor: open ? 'rgba(0,0,0,0.06)' : colors.border,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <MaterialCommunityIcons
            name={count ? 'bell-badge-outline' : 'bell-outline'}
            size={20}
            color={open ? '#111827' : colors.text}
          />
        </Pressable>
        {count ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 4,
              borderRadius: radius.full,
              backgroundColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: open ? '#F8CB46' : colors.surface,
            }}
          >
            <Text variant="caption" weight="bold" style={{ color: '#FFFFFF', fontSize: 10 }}>
              {count > 99 ? '99+' : count}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <IconButton
        icon={count ? 'bell-badge-outline' : 'bell-outline'}
        accessibilityLabel={t('notifications.open', { count })}
        onPress={() => router.push('/account/notifications')}
      />
      {count ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: radius.full,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" weight="bold" style={{ color: '#FFFFFF', fontSize: 11 }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
