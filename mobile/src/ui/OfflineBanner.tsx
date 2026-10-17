import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

/** "You are offline. Showing saved data." when the phone has no internet. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const net = useNetInfo();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  if (!offline) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        backgroundColor: colors.warning,
      }}
    >
      <MaterialCommunityIcons name="wifi-off" size={18} color="#fff" />
      <Text variant="caption" weight="semibold" style={{ color: '#fff', flex: 1 }}>
        {t('errors.offline')}
      </Text>
    </View>
  );
}
