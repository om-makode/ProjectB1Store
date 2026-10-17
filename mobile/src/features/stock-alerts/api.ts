import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

export async function hasSession(): Promise<boolean> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

/** Throws (e.g. 'login_required', 'too_many_alerts') when the server refuses. */
export const setStockAlert = async (variantId: number, on: boolean) =>
  unwrap(getSupabase().rpc('toggle_stock_alert', { p_variant_id: variantId, p_on: on }));
