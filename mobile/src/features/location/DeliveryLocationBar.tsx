import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { AddressLabel } from '@/features/addresses/api';
import { useMyAddresses } from '@/features/addresses/hooks';
import { spacing } from '@/theme/tokens';
import { Text } from '@/ui';

import { LocationSheet } from './LocationSheet';
import { selectAddress } from './selectLocation';
import { useDeliveryLocation } from './store';

/** "Delivering to ▾ Home · 12 Rajapeth, Amravati" at the top of Home. */
export function DeliveryLocationBar({ color }: { color: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const location = useDeliveryLocation((s) => s.location);
  const addresses = useMyAddresses();

  // Logged-in users with no choice yet start at their default address.
  useEffect(() => {
    if (location) return;
    const def = addresses.data?.find((a) => a.is_default);
    if (def) void selectAddress(def, t(`address.label.${(def.label as AddressLabel) ?? 'other'}`));
  }, [location, addresses.data, t]);

  return (
    <>
      <Pressable
        testID="delivery-location"
        accessibilityRole="button"
        accessibilityLabel={
          location
            ? `${t('location.deliveringTo')} ${location.title}, ${location.subtitle}`
            : t('location.setLocation')
        }
        onPress={() => setOpen(true)}
        hitSlop={8}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <MaterialCommunityIcons name="map-marker" size={18} color={color} />
          <Text variant="caption" weight="bold" style={{ color }} numberOfLines={1}>
            {location
              ? `${t('location.deliveringTo')} · ${location.title}`
              : t('location.setLocation')}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={color} />
        </View>
        {location ? (
          <Text variant="caption" style={{ color }} numberOfLines={1}>
            {location.serviceable ? location.subtitle : t('location.notServiceable')}
          </Text>
        ) : null}
      </Pressable>
      <LocationSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
