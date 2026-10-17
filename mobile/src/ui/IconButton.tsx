import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

import { minTouch, type ColorName } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type IconButtonProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
  /** Required: no unlabeled icon buttons. */
  accessibilityLabel: string;
  color?: ColorName;
  size?: number;
  disabled?: boolean;
};

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color = 'text',
  size = 24,
  disabled,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: minTouch,
        height: minTouch,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon} size={size} color={colors[color]} />
    </Pressable>
  );
}
