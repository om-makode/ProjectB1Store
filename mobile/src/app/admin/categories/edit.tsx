import { useLocalSearchParams } from 'expo-router';

import { CategoryEditScreen } from '@/features/admin/CategoryEditScreen';

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function CategoryEditRoute() {
  const { id, parent } = useLocalSearchParams<{ id?: string; parent?: string }>();
  return (
    <CategoryEditScreen key={id ?? `new-${parent ?? ''}`} id={num(id)} parentId={num(parent)} />
  );
}
