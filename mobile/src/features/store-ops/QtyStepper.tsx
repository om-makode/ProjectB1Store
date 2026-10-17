import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { IconButton } from '@/ui';

/** − [n] + with a typeable number: staff often receive 24 or 48 at once. */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 10000,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
      }}
    >
      <IconButton icon="minus" accessibilityLabel="-" onPress={() => onChange(clamp(value - 1))} />
      <TextInput
        accessibilityLabel={t('storeOps.stock.qty')}
        value={String(value)}
        onChangeText={(s) => onChange(clamp(Number(s.replace(/\D/g, '') || 0)))}
        keyboardType="number-pad"
        maxLength={5}
        style={{
          minWidth: 56,
          textAlign: 'center',
          fontSize: 17,
          fontWeight: '700',
          color: colors.text,
          paddingVertical: spacing.sm,
        }}
      />
      <IconButton icon="plus" accessibilityLabel="+" onPress={() => onChange(clamp(value + 1))} />
    </View>
  );
}
