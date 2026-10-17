import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/features/catalog/screens/CategoryScreen';

export default function CategoryRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CategoryScreen slug={slug} />;
}
