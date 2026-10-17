import { useLocalSearchParams } from 'expo-router';

import { CollectionScreen } from '@/features/catalog/screens/CollectionScreen';

export default function CollectionRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CollectionScreen slug={slug} />;
}
