import { useLocalSearchParams } from 'expo-router';

import { ProductScreen } from '@/features/catalog/screens/ProductScreen';

export default function ProductRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <ProductScreen slug={slug} />;
}
