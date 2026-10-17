import { useLocalSearchParams } from 'expo-router';

import { ProductReviewsScreen } from '@/features/engagement/ProductReviewsScreen';

export default function ProductReviewsRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <ProductReviewsScreen slug={slug} />;
}
