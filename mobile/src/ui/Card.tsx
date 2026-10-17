import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, shadow, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type CardProps = {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Shadow depth (default 'sm'). */
  elevation?: 'none' | 'sm' | 'md' | 'lg';
};

export function Card({
  children,
  onPress,
  padded = true,
  style,
  accessibilityLabel,
  elevation = 'sm',
}: CardProps) {
  const { colors, isDark } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: padded ? spacing.lg : 0,
    borderWidth: 1,
    borderColor: isDark ? colors.border : colors.hairline,
    ...(isDark ? {} : shadow[elevation]),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
