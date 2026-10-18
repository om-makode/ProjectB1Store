import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AddressRow } from '@/features/addresses/AddressRow';
import type { AddressLabel } from '@/features/addresses/api';
import { useMyAddresses } from '@/features/addresses/hooks';
import { useIsLoggedIn } from '@/features/auth/store';
import { openLogin } from '@/features/auth/useRequireLogin';
import { spacing } from '@/theme/tokens';
import { Button, Sheet, Skeleton, Text, showToast } from '@/ui';

import { locationErrorText } from './messages';
import { selectAddress, selectCurrentPosition } from './selectLocation';
import { useDeliveryLocation } from './store';

export function LocationSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const loggedIn = useIsLoggedIn();
  const addresses = useMyAddresses();
  const selectedId = useDeliveryLocation((s) => s.location?.addressId ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const after = (serviceable: boolean) => {
    if (!serviceable) showToast(t('location.notServiceable'), 'warning');
    onClose();
  };

  const useGps = async () => {
    setBusy('gps');
    setError(null);
    try {
      const loc = await selectCurrentPosition(t('location.currentLocation'));
      after(loc.serviceable);
    } catch (e) {
      setError(locationErrorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const goAdd = () => {
    onClose();
    if (loggedIn) router.push('/account/addresses/edit');
    else openLogin('addresses');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('location.chooseTitle')} scroll>
      <View style={{ gap: spacing.md }}>
        <Button
          testID="location-gps"
          title={t('location.useCurrent')}
          icon="crosshairs-gps"
          onPress={useGps}
          loading={busy === 'gps'}
          disabled={!!busy}
          fullWidth
        />
        {error ? (
          <Text variant="caption" color="danger">
            {error}
          </Text>
        ) : null}

        {loggedIn ? (
          <>
            <Text variant="title">{t('location.savedAddresses')}</Text>
            {addresses.isLoading ? <Skeleton width="100%" height={72} /> : null}
            {addresses.data?.map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                selected={a.id === selectedId}
                onPress={async () => {
                  setBusy(a.id);
                  const loc = await selectAddress(
                    a,
                    t(`address.label.${(a.label as AddressLabel) ?? 'other'}`),
                  );
                  setBusy(null);
                  after(loc.serviceable);
                }}
              />
            ))}
          </>
        ) : (
          <Text color="textMuted">{t('location.loginForAddresses')}</Text>
        )}

        <Button
          title={loggedIn ? t('location.addAddress') : t('account.login')}
          icon={loggedIn ? 'plus' : 'login'}
          variant="secondary"
          onPress={goAdd}
          fullWidth
        />
      </View>
    </Sheet>
  );
}
