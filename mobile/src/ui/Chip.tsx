import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Optional category colour (hex) used when selected. */
  tint?: string;
};

export function Chip({ label, selected, onPress, icon, tint }: ChipProps) {
  const { colors } = useTheme();
  const active = tint ?? colors.primary;
  const fg = selected ? active : colors.text;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[
        styles.chip,
        {
          borderColor: selected ? active : colors.border,
          backgroundColor: selected ? (tint ? `${active}1A` : colors.primarySoft) : colors.surface,
        },
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon} size={16} color={fg} /> : null}
      <Text variant="body" weight={selected ? 'semibold' : 'regular'} style={{ color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
});
