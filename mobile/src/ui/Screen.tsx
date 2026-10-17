import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  /** Centre content at this width on wide screens (web/tablet). Default: full width. */
  maxWidth?: number;
};

/** Safe-area aware screen container; keyboard-avoiding when scrollable. */
export function Screen({
  children,
  scroll,
  padded = true,
  edges = ['top'],
  maxWidth,
}: ScreenProps) {
  const { colors } = useTheme();
  const pad = padded ? spacing.lg : 0;
  const width: ViewStyle | null = maxWidth
    ? { width: '100%', maxWidth, alignSelf: 'center' }
    : null;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.background }}>
      {scroll ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[{ padding: pad, gap: spacing.lg }, width]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[{ flex: 1, padding: pad, gap: spacing.lg }, width]}>{children}</View>
      )}
    </SafeAreaView>
  );
}
