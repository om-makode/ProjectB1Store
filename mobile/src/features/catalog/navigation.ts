import { router } from 'expo-router';

import { useCategoryTree } from './hooks';
import type { BannerLink } from './types';

export const openCategory = (slug: string) =>
  router.push({ pathname: '/category/[slug]', params: { slug } });

export const openProduct = (slug: string) =>
  router.push({ pathname: '/product/[slug]', params: { slug } });

export const openCollection = (slug: string) =>
  router.push({ pathname: '/collection/[slug]', params: { slug } });

/** Where a banner (or any admin-defined link) goes. */
export function openLink(link: BannerLink | null | undefined) {
  if (!link?.value) return;
  switch (link.type) {
    case 'category':
      return openCategory(link.value);
    case 'product':
      return openProduct(link.value);
    case 'collection':
      return openCollection(link.value);
    case 'search':
      return router.push({ pathname: '/search', params: { q: link.value } });
  }
}

/** Category colour for a (sub-)category id: its own colour, else its parent's. */
export function useCategoryTint() {
  const { tree } = useCategoryTree();
  return (categoryId: number | null | undefined): string | null => {
    if (!tree || !categoryId) return null;
    const c = tree.byId(categoryId);
    if (!c) return null;
    return c.color ?? (c.parent_id ? (tree.byId(c.parent_id)?.color ?? null) : null);
  };
}

/** Category icon for a (sub-)category id: its own icon, else its parent's (placeholder art). */
export function useCategoryIcon() {
  const { tree } = useCategoryTree();
  return (categoryId: number | null | undefined): string | null => {
    if (!tree || !categoryId) return null;
    const c = tree.byId(categoryId);
    if (!c) return null;
    return c.icon ?? (c.parent_id ? (tree.byId(c.parent_id)?.icon ?? null) : null);
  };
}
