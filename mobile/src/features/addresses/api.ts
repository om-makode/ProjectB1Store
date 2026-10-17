import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/helpers';

export type Address = Tables<'addresses'>;
export type AddressLabel = 'home' | 'work' | 'other';

export type AddressInput = {
  label: AddressLabel;
  receiver_name: string;
  receiver_phone: string;
  house: string;
  area: string;
  landmark: string | null;
  city: string;
  pincode: string;
  /** Optional: GPS is a convenience. Delivery is checked at checkout (GPS or pincode). */
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
};

const COLUMNS =
  'id, user_id, label, receiver_name, receiver_phone, house, area, landmark, city, pincode, latitude, longitude, is_serviceable, is_default, deleted_at, created_at, updated_at';

// `location` and `is_serviceable` are set by the server trigger from latitude/longitude
// (or the pincode when there is no GPS point).
const point = (a: { latitude: number | null; longitude: number | null }) =>
  a.latitude != null && a.longitude != null
    ? `SRID=4326;POINT(${a.longitude} ${a.latitude})`
    : null;

export const listMyAddresses = async (): Promise<Address[]> =>
  (await unwrap(
    getSupabase()
      .from('addresses')
      .select(COLUMNS)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false }),
  )) as Address[];

export const createAddress = async (a: AddressInput): Promise<Address> =>
  (await unwrap(
    getSupabase()
      .from('addresses')
      .insert({ ...a, location: point(a) })
      .select(COLUMNS)
      .single(),
  )) as Address;

export const updateAddress = async (id: string, a: AddressInput): Promise<Address> =>
  (await unwrap(
    getSupabase()
      .from('addresses')
      .update({ ...a, location: point(a) })
      .eq('id', id)
      .select(COLUMNS)
      .single(),
  )) as Address;

export const deleteAddress = async (id: string) =>
  unwrap(getSupabase().rpc('delete_address', { p_address_id: id }));
