import type { ComponentRef, Ref } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { useSettings } from '@/stores/settings';
import { fontFor } from '@/theme/fonts';
import { fontSize, minTouch, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

import { Text } from './Text';

export type TextInputRef = ComponentRef<typeof TextInput>;

export type TextFieldProps = TextInputProps & {
  ref?: Ref<TextInputRef>;
  label: string;
  error?: string | null;
  hint?: string;
};

/** Labelled input with an error line, sized for large text and 48dp touch. */
export function TextField({ ref, label, error, hint, style, ...rest }: TextFieldProps) {
  const { colors, textScale } = useTheme();
  const lang = useSettings((s) => s.language);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" weight="semibold" color="textMuted">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          {
            minHeight: minTouch,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.md,
            color: colors.text,
            fontSize: fontSize.bodyLg * textScale,
            fontFamily: fontFor('regular', lang),
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
