import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { minTouch, radius, spacing, type ColorName } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

const look: Record<Variant, { bg: ColorName | 'transparent'; fg: ColorName; border?: ColorName }> =
  {
    primary: { bg: 'primary', fg: 'primaryText' },
    secondary: { bg: 'surface', fg: 'primary', border: 'primary' },
    ghost: { bg: 'transparent', fg: 'primary' },
    danger: { bg: 'danger', fg: 'primaryText' },
  };

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  fullWidth,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const l = look[variant];
  const inactive = disabled || loading;
  const fg = variant === 'danger' ? '#FFFFFF' : colors[l.fg];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'lg' ? 56 : minTouch,
          backgroundColor: l.bg === 'transparent' ? 'transparent' : colors[l.bg],
          borderColor: l.border ? colors[l.border] : 'transparent',
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : icon ? (
          <MaterialCommunityIcons name={icon} size={20} color={fg} />
        ) : null}
        <Text variant={size === 'lg' ? 'bodyLg' : 'body'} weight="semibold" style={{ color: fg }}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
