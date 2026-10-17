import type { ReactNode } from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout } from '@/theme/tokens';

/** Usable content width: the window, capped at `max` (centred on wide web/tablet screens). */
export function useContentWidth(max: number = layout.contentMax) {
  const { width } = useWindowDimensions();
  return Math.min(width, max);
}

/** Product-grid columns for a container width: 2 phone · 3–4 tablet · 5–6 desktop. */
export function gridColumns(width: number) {
  if (width < 520) return 2;
  if (width < 760) return 3;
  if (width < 1000) return 4;
  if (width < 1300) return 5;
  return 6;
}

/** True when there's room for two-column layouts (product detail, checkout). */
export function useIsWide(min = 900) {
  const { width } = useWindowDimensions();
  return width >= min;
}

/** Centres its children with a max width; full width on phones. */
export function MaxWidth({
  children,
  max = layout.contentMax,
  style,
}: {
  children: ReactNode;
  max?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: '100%', maxWidth: max, alignSelf: 'center' }, style]}>{children}</View>
  );
}
