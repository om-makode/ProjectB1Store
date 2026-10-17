import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
type ToastState = { id: number; message: string; tone: ToastTone } | null;

const useToastStore = create<{ toast: ToastState }>(() => ({ toast: null }));
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

const dismiss = () => useToastStore.setState({ toast: null });

/** Small, non-blocking, auto-dismissing message; announced to screen readers. */
export function showToast(message: string, tone: ToastTone = 'info') {
  useToastStore.setState({ toast: { id: nextId++, message, tone } });
  AccessibilityInfo.announceForAccessibility?.(message);
  if (timer) clearTimeout(timer);
  timer = setTimeout(dismiss, 2800);
}

export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (!toast) return null;

  const bg = {
    info: colors.text,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[toast.tone];

  return (
    <Pressable
      accessibilityRole="alert"
      onPress={dismiss}
      style={[styles.toast, { bottom: insets.bottom + 80, backgroundColor: bg }]}
    >
      <Text weight="medium" style={{ color: colors.background }}>
        {toast.message}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
