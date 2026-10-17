import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme/useTheme';

/**
 * FSSAI-style mark: square border + green dot (veg) or brown triangle (non-veg).
 * Shape AND colour, never colour alone. Renders nothing for non-food (null).
 */
export function VegMark({
  isVeg,
  size = 14,
}: {
  isVeg: boolean | null | undefined;
  size?: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (isVeg === null || isVeg === undefined) return null;
  const c = isVeg ? colors.veg : colors.nonVeg;
  const inner = size * 0.5;

  return (
    <View
      testID={isVeg ? 'veg-mark' : 'non-veg-mark'}
      accessible
      accessibilityRole="image"
      accessibilityLabel={isVeg ? t('food.veg') : t('food.nonVeg')}
      style={{
        width: size,
        height: size,
        borderWidth: 1.5,
        borderColor: c,
        borderRadius: 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isVeg ? (
        <View
          style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: c }}
        />
      ) : (
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: inner / 2,
            borderRightWidth: inner / 2,
            borderBottomWidth: inner * 0.9,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: c,
          }}
        />
      )}
    </View>
  );
}
