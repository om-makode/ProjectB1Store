import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, spacing, type ColorName } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Text } from '@/ui';

import type { Column } from './api';

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

/** One colour + icon per board column, used by tabs, column headers and order cards. */
export const COLUMN_LOOK: Record<Column, { color: ColorName; icon: Icon }> = {
  new: { color: 'warning', icon: 'bell-ring-outline' },
  accepted: { color: 'info', icon: 'check-circle-outline' },
  packing: { color: 'discount', icon: 'basket-outline' },
  ready: { color: 'success', icon: 'package-variant-closed' },
  out: { color: 'primary', icon: 'moped-outline' },
  done: { color: 'outOfStock', icon: 'check-all' },
};

/** Small dashboard number: icon, big value, label. */
export function StatTile({
  icon,
  label,
  value,
  tone = 'primary',
  style,
}: {
  icon: Icon;
  label: string;
  value: string;
  tone?: ColorName;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[
        {
          minWidth: 128,
          flexGrow: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderWidth: isDark ? 1 : 0,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOpacity: isDark ? 0 : 0.05,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 1 },
          elevation: isDark ? 0 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <MaterialCommunityIcons name={icon} size={22} color={colors[tone]} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text variant="title" weight="bold" numberOfLines={1}>
          {value}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Minutes since a timestamp, coloured: green < 5 min, amber < 10 min, red after. */
export function ElapsedPill({ since, now }: { since: string; now: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  if (Number.isNaN(mins)) return null;
  const tone: ColorName = mins < 5 ? 'success' : mins < 10 ? 'warning' : 'danger';
  return (
    <View
      accessibilityLabel={t('storeOps.ui.elapsedA11y', { count: mins })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: colors[tone],
      }}
    >
      <MaterialCommunityIcons name="timer-outline" size={13} color="#fff" />
      <Text variant="caption" weight="bold" style={{ color: '#fff' }}>
        {mins < 1 ? t('storeOps.ui.justNow') : t('storeOps.ui.minutes', { count: mins })}
      </Text>
    </View>
  );
}

/** Count bubble for tabs and column headers. */
export function CountBubble({ count, tone }: { count: number; tone: ColorName }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: count > 0 ? colors[tone] : colors.surfaceAlt,
      }}
    >
      <Text
        variant="caption"
        weight="bold"
        style={{ color: count > 0 ? '#fff' : colors.textMuted, fontSize: 12 }}
      >
        {count}
      </Text>
    </View>
  );
}

/** Thin progress bar (e.g. "4/6 picked"). */
export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: ColorName }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height: 8,
        borderRadius: radius.full,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          borderRadius: radius.full,
          backgroundColor: colors[tone],
        }}
      />
    </View>
  );
}
