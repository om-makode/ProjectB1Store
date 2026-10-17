import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, Screen } from '@/ui';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        icon="map-marker-question-outline"
        title={t('errors.notFound')}
        action={{ label: t('tabs.home'), onPress: () => router.replace('/') }}
      />
    </Screen>
  );
}
