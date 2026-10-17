import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

export type ConfigRow = { key: string; value: unknown };

export const fetchPublicConfig = (): Promise<ConfigRow[]> =>
  unwrap(getSupabase().from('app_config').select('key, value').eq('is_public', true));
