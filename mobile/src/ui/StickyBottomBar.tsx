import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, shadow, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

/**
 * Bottom action bar for product detail, cart and checkout: sits above the safe area, soft shadow,
 * content centred to a readable width on wide screens.
 */
export function StickyBottomBar({
  children,
  max = layout.readableMax,
}: {
  children: ReactNode;
  max?: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.hairline,
        paddingTop: spacing.md,
        paddingBottom: Math.max(insets.bottom, spacing.md),
        paddingHorizontal: spacing.lg,
        ...shadow.lg,
        shadowOffset: { width: 0, height: -4 },
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: max,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}
      >
        {children}
      </View>
    </View>
  );
}
