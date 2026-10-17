import { Pressable, View } from 'react-native';

import { LANGUAGES, type Lang } from '@/i18n';
import { fontFor } from '@/theme/fonts';
import { minTouch, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Text } from '@/ui';

/** Three big buttons, each written in its own script so anyone can find their language. */
export function LanguagePicker({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: spacing.md }}>
      {LANGUAGES.map((l) => {
        const selected = l.code === value;
        return (
          <Pressable
            key={l.code}
            testID={`lang-${l.code}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${l.native} (${l.english})`}
            onPress={() => onChange(l.code)}
            style={{
              minHeight: minTouch + 16,
              borderRadius: radius.lg,
              borderWidth: 2,
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? `${colors.primary}14` : colors.surface,
              paddingHorizontal: spacing.lg,
              justifyContent: 'center',
            }}
          >
            <Text
              variant="title"
              style={{ fontFamily: fontFor('semibold', l.code) }}
              color={selected ? 'primary' : 'text'}
            >
              {l.native}
            </Text>
            {l.code !== 'en' ? (
              <Text variant="caption" color="textMuted">
                {l.english}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
