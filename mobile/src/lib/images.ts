import { envResult } from '@/config/env';

/** Public URL for a path in the public `catalog` bucket (paths are stored, never full URLs). */
export function catalogImageUrl(path: string | null | undefined): string | null {
  if (!path || !envResult.ok) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${envResult.env.supabaseUrl}/storage/v1/object/public/catalog/${path.replace(/^\/+/, '')}`;
}
