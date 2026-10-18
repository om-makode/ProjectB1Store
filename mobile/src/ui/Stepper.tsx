import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { radius, shadow } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';
import { showToast } from './Toast';

export type StepperProps = {
  quantity: number;
  max: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Out of stock / store closed. */
  disabled?: boolean;
  size?: 'sm' | 'md';
};

const tick = () => {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync().catch(() => undefined);
};
const hit = { top: 7, bottom: 7, left: 7, right: 7 }; // 48 dp effective target

/** quantity 0 → green ADD button; > 0 → − n + */
export function Stepper({
  quantity,
  max,
  onAdd,
  onIncrement,
  onDecrement,
  disabled,
  size = 'sm',
}: StepperProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const h = size === 'sm' ? 34 : 44;
  const minW = size === 'sm' ? 68 : 80;
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const prev = useRef(quantity);
  useEffect(() => {
    // Small "bump" when the quantity changes: confirms the tap without a toast.
    if (prev.current !== quantity && !reduceMotion) {
      scale.value = withSequence(
        withTiming(1.08, { duration: 90 }),
        withTiming(1, { duration: 120 }),
      );
    }
    prev.current = quantity;
  }, [quantity, reduceMotion, scale]);
  const bump = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (quantity <= 0) {
    return (
      <Pressable
        testID="stepper-add"
        accessibilityRole="button"
        accessibilityLabel={t('cart.add')}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        hitSlop={hit}
        onPress={() => {
          tick();
          onAdd();
        }}
        style={({ pressed }) => [
          styles.box,
          {
            minWidth: minW,
            height: h,
            borderWidth: 1.5,
            borderColor: colors.primary,
            backgroundColor: pressed ? colors.primarySoft : colors.surface,
            opacity: disabled ? 0.4 : 1,
            justifyContent: 'center',
          },
          shadow.sm,
        ]}
      >
        <Text weight="bold" color="primary" align="center" style={{ letterSpacing: 0.5 }}>
          {t('cart.add')}
        </Text>
      </Pressable>
    );
  }

  const atMax = quantity >= max;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('cart.inCart', { count: quantity })}
      style={[
        styles.box,
        styles.row,
        { minWidth: minW, height: h, backgroundColor: colors.primary },
        shadow.sm,
        bump,
      ]}
    >
      <Pressable
        testID="stepper-decrement"
        accessibilityRole="button"
        accessibilityLabel={t('cart.decrease')}
        hitSlop={hit}
        onPress={() => {
          tick();
          onDecrement();
        }}
        style={styles.side}
      >
        <Text weight="bold" color="primaryText" style={{ fontSize: 18 }}>
          −
        </Text>
      </Pressable>
      <Text weight="bold" color="primaryText" testID="stepper-quantity">
        {quantity}
      </Text>
      <Pressable
        testID="stepper-increment"
        accessibilityRole="button"
        accessibilityLabel={t('cart.increase')}
        accessibilityState={{ disabled: atMax }}
        hitSlop={hit}
        onPress={() => {
          if (atMax) {
            showToast(t('cart.maxPerOrder', { max }), 'warning');
            return;
          }
          tick();
          onIncrement();
        }}
        style={[styles.side, { opacity: atMax ? 0.5 : 1 }]}
      >
        <Text weight="bold" color="primaryText" style={{ fontSize: 18 }}>
          +
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { paddingHorizontal: 10, alignSelf: 'stretch', justifyContent: 'center' },
});
