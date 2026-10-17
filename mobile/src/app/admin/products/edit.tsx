import { useLocalSearchParams } from 'expo-router';

import { ProductEditScreen } from '@/features/admin/ProductEditScreen';

export default function ProductEditRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const n = id && /^\d+$/.test(id) ? Number(id) : null;
  return <ProductEditScreen key={id ?? 'new'} id={n} />;
}
