import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Badge, Text } from '@/ui';

import type { Address, AddressLabel } from './api';

const ICON: Record<AddressLabel, keyof typeof MaterialCommunityIcons.glyphMap> = {
  home: 'home-outline',
  work: 'briefcase-outline',
  other: 'map-marker-outline',
};

export const addressLine = (a: Pick<Address, 'house' | 'area' | 'city' | 'pincode'>) =>
  `${a.house}, ${a.area}, ${a.city} ${a.pincode}`;

export function AddressRow({
  address,
  onPress,
  selected,
  right,
  showServiceability = true,
}: {
  address: Address;
  onPress: () => void;
  selected?: boolean;
  right?: ReactNode;
  /** Checkout and the location picker show "not delivering here"; the address book doesn't. */
  showServiceability?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = (address.label as AddressLabel) ?? 'other';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <MaterialCommunityIcons name={ICON[label]} size={24} color={colors.text} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text weight="semibold">{t(`address.label.${label}`)}</Text>
          {address.is_default ? <Badge label={t('address.default')} tone="info" /> : null}
        </View>
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {addressLine(address)}
        </Text>
        <Text variant="caption" color="textMuted">
          {address.receiver_name} · {address.receiver_phone}
        </Text>
        {showServiceability && !address.is_serviceable ? (
          <Text variant="caption" weight="semibold" color="danger">
            {t('address.notServiceableSaved')}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}
