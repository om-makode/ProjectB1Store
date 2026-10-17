import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoginRequired } from '@/features/auth/LoginRequired';
import { OrderReviewScreen } from '@/features/engagement/OrderReviewScreen';

export default function OrderReviewRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <LoginRequired reason="orders" title={t('reviews.title')}>
      <OrderReviewScreen orderId={id} />
    </LoginRequired>
  );
}
