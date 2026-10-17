import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useSettings } from '@/stores/settings';
import { fontFor, type FontWeight } from '@/theme/fonts';
import { fontSize, type ColorName, type TextVariant } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  weight?: FontWeight;
  color?: ColorName;
  align?: TextStyle['textAlign'];
  strike?: boolean;
};

const defaultWeight: Record<TextVariant, FontWeight> = {
  h1: 'bold',
  h2: 'bold',
  title: 'semibold',
  bodyLg: 'regular',
  body: 'regular',
  caption: 'regular',
};

export function Text({
  variant = 'body',
  weight,
  color = 'text',
  align,
  strike,
  style,
  ...rest
}: TextProps) {
  const lang = useSettings((s) => s.language);
  const { colors, textScale } = useTheme();
  const size = fontSize[variant] * textScale;
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        {
          fontFamily: fontFor(weight ?? defaultWeight[variant], lang),
          fontSize: size,
          lineHeight: Math.round(size * (lang === 'en' ? 1.35 : 1.5)), // room for Devanagari matras
          color: colors[color],
          textAlign: align,
          textDecorationLine: strike ? 'line-through' : undefined,
        },
        style,
      ]}
    />
  );
}
