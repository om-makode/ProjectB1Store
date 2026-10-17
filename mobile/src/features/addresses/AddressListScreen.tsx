import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { layout, spacing } from '@/theme/tokens';
import { Button, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from '@/ui';

import { AddressRow } from './AddressRow';
import { useMyAddresses } from './hooks';

export function AddressListScreen() {
  const { t } = useTranslation();
  const q = useMyAddresses();
  const add = () => router.push('/account/addresses/edit');

  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={t('address.title')} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}>
        {q.isLoading ? (
          [0, 1].map((i) => <Skeleton key={i} width="100%" height={88} />)
        ) : q.error && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.length > 0 ? (
          <>
            <Button
              title={t('address.add')}
              icon="plus"
              variant="secondary"
              onPress={add}
              fullWidth
            />
            {q.data.map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                showServiceability={false}
                onPress={() =>
                  router.push({ pathname: '/account/addresses/edit', params: { id: a.id } })
                }
              />
            ))}
          </>
        ) : (
          <EmptyState
            icon="map-marker-plus-outline"
            title={t('address.emptyTitle')}
            message={t('address.emptyBody')}
            action={{ label: t('address.add'), onPress: add }}
          />
        )}
      </View>
    </Screen>
  );
}
