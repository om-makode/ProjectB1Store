import { useEffect, useState } from 'react';
import { AccessibilityInfo, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { radius as radii } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type SkeletonProps = { width: DimensionValue; height: number; radius?: number };

/** Pulsing placeholder; static when the OS "Reduce motion" setting is on. */
export function Skeleton({ width, height, radius = radii.md }: SkeletonProps) {
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useSharedValue(1);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
  }, [reduceMotion, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt }, style]}
    />
  );
}
