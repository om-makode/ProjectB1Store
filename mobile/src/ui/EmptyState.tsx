import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Button } from './Button';
import { Text } from './Text';

export type EmptyStateProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.md,
        maxWidth: 420,
        alignSelf: 'center',
      }}
    >
      <View
        style={{
          width: 112,
          height: 112,
          borderRadius: 56,
          backgroundColor: colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.sm,
        }}
      >
        <MaterialCommunityIcons name={icon} size={56} color={colors.primary} />
      </View>
      <Text variant="title" weight="bold" align="center" accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text color="textMuted" align="center">
          {message}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button title={action.label} onPress={action.onPress} size="lg" />
        </View>
      ) : null}
    </View>
  );
}
