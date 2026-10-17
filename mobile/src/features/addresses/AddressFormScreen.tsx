import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, View } from 'react-native';

import { getCurrentPosition } from '@/features/location/device';
import { locationErrorText } from '@/features/location/messages';
import { useMyProfile } from '@/features/profile/hooks';
import { confirmAction } from '@/lib/confirm';
import { toAppError } from '@/lib/errors';
import { goBack } from '@/lib/navigation';
import { layout, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Button, Card, Chip, Screen, ScreenHeader, Text, TextField, showToast } from '@/ui';

import type { AddressLabel } from './api';
import { useDeleteAddress, useMyAddresses, useSaveAddress } from './hooks';
import { validateAddress, type AddressDraft, type AddressErrors } from './validate';

const LABELS: AddressLabel[] = ['home', 'work', 'other'];

export function AddressFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const addresses = useMyAddresses();
  const profile = useMyProfile();
  const existing = id ? addresses.data?.find((a) => a.id === id) : undefined;

  const [draft, setDraft] = useState<AddressDraft>(() =>
    existing
      ? {
          label: (existing.label as AddressLabel) ?? 'home',
          receiver_name: existing.receiver_name,
          receiver_phone: existing.receiver_phone,
          house: existing.house,
          area: existing.area,
          landmark: existing.landmark ?? '',
          city: existing.city,
          pincode: existing.pincode,
          latitude: existing.latitude,
          longitude: existing.longitude,
          is_default: existing.is_default,
        }
      : {
          label: 'home',
          receiver_name: profile.data?.full_name ?? '',
          receiver_phone: (profile.data?.phone ?? '').replace(/^\+91/, ''),
          house: '',
          area: '',
          landmark: '',
          city: '',
          pincode: '',
          latitude: null,
          longitude: null,
          is_default: (addresses.data?.length ?? 0) === 0,
        },
  );
  const [errors, setErrors] = useState<AddressErrors>({});
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const save = useSaveAddress();
  const del = useDeleteAddress();

  const set = <K extends keyof AddressDraft>(k: K, v: AddressDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const err = (k: keyof AddressDraft) => {
    const key = errors[k];
    return key && key !== 'location' ? t(`address.${key}`) : null;
  };

  const useGps = async () => {
    setGpsBusy(true);
    setGpsError(null);
    try {
      const pos = await getCurrentPosition();
      setDraft((d) => ({
        ...d,
        latitude: pos.latitude,
        longitude: pos.longitude,
        // Fill only empty fields: never overwrite what the user typed.
        house: d.house || pos.address?.house || '',
        area: d.area || pos.address?.area || '',
        city: d.city || pos.address?.city || '',
        pincode: d.pincode || pos.address?.pincode || '',
      }));
      setErrors((e) => ({ ...e, latitude: undefined }));
    } catch (e) {
      setGpsError(locationErrorText(e, t));
    } finally {
      setGpsBusy(false);
    }
  };

  const submit = () => {
    const { errors: e, input } = validateAddress(draft);
    setErrors(e);
    if (!input) return;
    save.mutate(
      { id: existing?.id, input },
      {
        onSuccess: () => {
          showToast(t('address.saved'), 'success');
          goBack('/account/addresses');
        },
        onError: (x) => {
          const ae = toAppError(x);
          showToast(
            ae.message.includes('ADDRESS_LIMIT')
              ? t('address.limit')
              : ae.kind === 'network'
                ? t('errors.network')
                : t('errors.server'),
            'danger',
          );
        },
      },
    );
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirmAction(
      t('address.deleteConfirm'),
      undefined,
      t('address.delete'),
      t('common.cancel'),
    );
    if (!ok) return;
    del.mutate(existing.id, {
      onSuccess: () => {
        showToast(t('address.deleted'));
        goBack('/account/addresses');
      },
      onError: () => showToast(t('errors.server'), 'danger'),
    });
  };

  const hasPoint = draft.latitude != null && draft.longitude != null;

  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={existing ? t('address.edit') : t('address.new')} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Button
              testID="address-gps"
              title={hasPoint ? t('address.gpsUpdate') : t('address.useGps')}
              icon="crosshairs-gps"
              variant="secondary"
              onPress={useGps}
              loading={gpsBusy}
              fullWidth
            />
            {/* GPS only fills the fields. Delivery availability is checked at checkout. */}
            {gpsError ? (
              <Text variant="caption" color="danger">
                {gpsError}
              </Text>
            ) : hasPoint ? (
              <Text variant="caption" color="success">
                {t('address.locationSet')}
              </Text>
            ) : (
              <Text variant="caption" color="textMuted">
                {t('address.gpsOptional')}
              </Text>
            )}
          </View>
        </Card>

        <TextField
          label={t('address.house')}
          value={draft.house}
          onChangeText={(v) => set('house', v)}
          error={err('house')}
        />
        <TextField
          label={t('address.area')}
          value={draft.area}
          onChangeText={(v) => set('area', v)}
          error={err('area')}
        />
        <TextField
          label={t('address.landmark')}
          value={draft.landmark}
          onChangeText={(v) => set('landmark', v)}
        />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('address.city')}
              value={draft.city}
              onChangeText={(v) => set('city', v)}
              error={err('city')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('address.pincode')}
              value={draft.pincode}
              onChangeText={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              error={err('pincode')}
            />
          </View>
        </View>
        <TextField
          label={t('address.receiverName')}
          value={draft.receiver_name}
          onChangeText={(v) => set('receiver_name', v)}
          autoComplete="name"
          error={err('receiver_name')}
        />
        <TextField
          label={t('address.receiverPhone')}
          value={draft.receiver_phone}
          onChangeText={(v) => set('receiver_phone', v.replace(/[^\d+]/g, '').slice(0, 13))}
          keyboardType="phone-pad"
          autoComplete="tel"
          error={err('receiver_phone')}
        />

        <View style={{ gap: spacing.sm }}>
          <Text variant="caption" weight="semibold" color="textMuted">
            {t('address.labelTitle')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {LABELS.map((l) => (
              <Chip
                key={l}
                label={t(`address.label.${l}`)}
                selected={draft.label === l}
                onPress={() => set('label', l)}
              />
            ))}
          </View>
        </View>

        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={{ flex: 1 }}>{t('address.setDefault')}</Text>
          <Switch
            accessibilityLabel={t('address.setDefault')}
            value={draft.is_default}
            onValueChange={(v) => set('is_default', v)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <Button
          testID="address-save"
          title={t('common.save')}
          onPress={submit}
          loading={save.isPending}
          fullWidth
          size="lg"
        />
        {existing ? (
          <Button
            title={t('address.delete')}
            variant="ghost"
            icon="trash-can-outline"
            onPress={remove}
            loading={del.isPending}
          />
        ) : null}
      </View>
    </Screen>
  );
}
