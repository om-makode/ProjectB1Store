import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

export type Serviceability = {
  serviceable: boolean;
  store_id: number | null;
  nearest_store_id: number | null;
  distance_km: number | null;
  eta_minutes: number | null;
  reason: 'NO_LOCATION' | 'NO_STORE' | 'OUTSIDE_AREA' | null;
};

export const checkServiceability = async (lat: number, lng: number): Promise<Serviceability> =>
  (await unwrap(
    getSupabase().rpc('check_serviceability', { p_lat: lat, p_lng: lng }),
  )) as unknown as Serviceability;
