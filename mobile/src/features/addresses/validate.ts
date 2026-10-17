import type { AddressInput } from './api';

export type AddressDraft = Omit<AddressInput, 'latitude' | 'longitude' | 'landmark'> & {
  landmark: string;
  latitude: number | null;
  longitude: number | null;
};

export type AddressErrorKey = 'required' | 'phoneError' | 'pincodeError' | 'location';
export type AddressErrors = Partial<Record<keyof AddressDraft, AddressErrorKey>>;

/** Same rules as the `addresses` table checks, so the server never has to reject the form. */
export function validateAddress(d: AddressDraft): {
  errors: AddressErrors;
  input: AddressInput | null;
} {
  const e: AddressErrors = {};
  const name = d.receiver_name.trim();
  const phone = d.receiver_phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (name.length < 2 || name.length > 80) e.receiver_name = 'required';
  if (!/^[6-9]\d{9}$/.test(phone)) e.receiver_phone = 'phoneError';
  if (!d.house.trim()) e.house = 'required';
  if (d.area.trim().length < 2) e.area = 'required';
  if (d.city.trim().length < 2) e.city = 'required';
  if (!/^[1-9]\d{5}$/.test(d.pincode.trim())) e.pincode = 'pincodeError';
  // Location is optional: any address can be saved; delivery is checked at checkout.
  if (Object.keys(e).length > 0) return { errors: e, input: null };
  return {
    errors: e,
    input: {
      label: d.label,
      receiver_name: name,
      receiver_phone: phone,
      house: d.house.trim(),
      area: d.area.trim(),
      landmark: d.landmark.trim() || null,
      city: d.city.trim(),
      pincode: d.pincode.trim(),
      latitude: d.latitude,
      longitude: d.longitude,
      is_default: d.is_default,
    },
  };
}
