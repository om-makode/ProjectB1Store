import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { radius } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import type { ColorName } from '@/theme/tokens';

/** Thin animated progress bar (free-delivery progress, order status). `value` is 0..1. */
export function ProgressBar({
  value,
  color = 'primary',
  height = 6,
  accessibilityLabel,
}: {
  value: number;
  color?: ColorName;
  height?: number;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const v = Math.max(0, Math.min(1, value));
  const progress = useSharedValue(reduceMotion ? v : 0);

  useEffect(() => {
    progress.value = reduceMotion ? v : withTiming(v, { duration: 450 });
  }, [v, reduceMotion, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{
        height,
        borderRadius: radius.full,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[{ height, borderRadius: radius.full, backgroundColor: colors[color] }, fill]}
      />
    </View>
  );
}
