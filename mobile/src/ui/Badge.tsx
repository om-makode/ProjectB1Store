import { View } from 'react-native';

import { radius, spacing, type ColorName } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const toneColor: Record<BadgeTone, ColorName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'textMuted',
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const c = colors[toneColor[tone]];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.sm,
        backgroundColor: `${c}1F`,
      }}
    >
      <Text variant="caption" weight="semibold" style={{ color: c }}>
        {label}
      </Text>
    </View>
  );
}
