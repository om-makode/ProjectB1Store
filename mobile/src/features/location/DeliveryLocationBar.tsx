import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { AddressLabel } from '@/features/addresses/api';
import { useMyAddresses } from '@/features/addresses/hooks';
import { useTheme } from '@/theme/useTheme';
import { radius } from '@/theme/tokens';
import { Text } from '@/ui';

import { LocationSheet } from './LocationSheet';
import { selectAddress } from './selectLocation';
import { useDeliveryLocation } from './store';

/** "Delivering to ▾ Home · 12 Rajapeth, Amravati" at the top of Home. */
export function DeliveryLocationBar({
  color,
  open = true,
  theme,
}: {
  color?: string;
  open?: boolean;
  theme?: {
    locationPillBg?: string;
    locationPillBorder?: string;
    locationTitle?: string;
    locationSubtitle?: string;
  };
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useDeliveryLocation((s) => s.location);
  const addresses = useMyAddresses();

  // Logged-in users with no choice yet start at their default address.
  useEffect(() => {
    if (location) return;
    const def = addresses.data?.find((a) => a.is_default);
    if (def) void selectAddress(def, t(`address.label.${(def.label as AddressLabel) ?? 'other'}`));
  }, [location, addresses.data, t]);

  const pillBg = open ? (theme?.locationPillBg ?? 'rgba(255, 255, 255, 0.72)') : colors.surface;
  const pillBorder = open ? (theme?.locationPillBorder ?? 'rgba(0, 0, 0, 0.06)') : colors.border;
  const titleColor = open ? (theme?.locationTitle ?? '#111827') : (color ?? colors.text);
  const subtitleColor = open ? (theme?.locationSubtitle ?? '#4B5563') : colors.textMuted;

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
        onPress={() => setSheetOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: pillBg,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: radius.full,
          alignSelf: 'flex-start',
          maxWidth: '100%',
          borderWidth: 1,
          borderColor: pillBorder,
          gap: 6,
          opacity: pressed ? 0.8 : 1,
          shadowColor: '#000000',
          shadowOpacity: 0.04,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        })}
      >
        <MaterialCommunityIcons name="map-marker" size={16} color="#DC2626" />
        <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: '800',
              color: titleColor,
            }}
            numberOfLines={1}
          >
            {location ? location.title : t('location.setLocation')}
          </Text>
          {location?.subtitle ? (
            <>
              <Text style={{ fontSize: 12, color: subtitleColor, fontWeight: '500' }}>·</Text>
              <Text
                style={{
                  fontSize: 12,
                  color: location.serviceable ? subtitleColor : colors.danger,
                  fontWeight: '500',
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                {location.serviceable ? location.subtitle : t('location.notServiceable')}
              </Text>
            </>
          ) : null}
        </View>
        <MaterialCommunityIcons name="chevron-down" size={16} color={titleColor} />
      </Pressable>
      <LocationSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
