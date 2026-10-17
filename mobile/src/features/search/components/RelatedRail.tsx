import { FlatList, View } from 'react-native';

import { useCategoryTint } from '@/features/catalog/navigation';
import { ProductCard } from '@/features/catalog/components/ProductCard';
import { spacing } from '@/theme/tokens';
import { Skeleton, Text } from '@/ui';

import { useRelated } from '../hooks';

type Props = { productId: number; kind: 'similar' | 'together'; title: string };

/** "Similar products" / "Often bought together" on product detail. Hidden when empty. */
export function RelatedRail({ productId, kind, title }: Props) {
  const q = useRelated(productId, kind);
  const tint = useCategoryTint();
  if (q.isPending) {
    return (
      <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
        <Skeleton width="40%" height={20} />
        <Skeleton width="100%" height={200} />
      </View>
    );
  }
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="title" accessibilityRole="header" style={{ paddingHorizontal: spacing.md }}>
        {title}
      </Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(p) => String(p.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
        renderItem={({ item }) => (
          <ProductCard product={item} width={150} tint={tint(item.category_id)} />
        )}
      />
    </View>
  );
}
