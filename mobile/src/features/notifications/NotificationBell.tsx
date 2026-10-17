import { router } from 'expo-router';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useIsLoggedIn } from '@/features/auth/store';
import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { IconButton, Text } from '@/ui';

import { useUnreadCount } from './hooks';

/** Bell with an unread badge; hidden for guests. */
export function NotificationBell() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const loggedIn = useIsLoggedIn();
  const unread = useUnreadCount();
  if (!loggedIn) return null;
  const count = unread.data ?? 0;

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
