import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

/** Seller details required by the Consumer Protection (E-Commerce) Rules, 2020 (public store row). */
export type SellerInfo = {
  id: number;
  name: unknown;
  address: unknown;
  phone: string | null;
  whatsapp: string | null;
  gstin: string | null;
  fssai_license: string | null;
};

export const fetchSellerInfo = async (): Promise<SellerInfo | null> => {
  const rows = await unwrap(
    getSupabase()
      .from('stores')
      .select('id, name, address, phone, whatsapp, gstin, fssai_license')
      .eq('is_active', true)
      .order('id')
      .limit(1),
  );
  return (rows?.[0] as SellerInfo | undefined) ?? null;
};
