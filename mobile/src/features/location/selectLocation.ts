import type { Address } from '@/features/addresses/api';
import { addressLine } from '@/features/addresses/AddressRow';

import { checkServiceability } from './api';
import { getCurrentPosition } from './device';
import { useDeliveryLocation, type DeliveryLocation } from './store';

const now = () => new Date().toISOString();

export async function selectAddress(a: Address, title: string): Promise<DeliveryLocation> {
  let eta: number | null = null;
  // Without GPS, the server already decided from the pincode (addresses.is_serviceable).
  let serviceable = a.is_serviceable;
  if (a.latitude != null && a.longitude != null) {
    try {
      const s = await checkServiceability(a.latitude, a.longitude);
      serviceable = s.serviceable;
      eta = s.eta_minutes;
    } catch {
      // offline: trust the server-computed flag on the address
    }
  }
  const loc: DeliveryLocation = {
    source: 'address',
    addressId: a.id,
    title,
    subtitle: addressLine(a),
    latitude: a.latitude,
    longitude: a.longitude,
    serviceable,
    etaMinutes: eta,
    checkedAt: now(),
  };
  useDeliveryLocation.getState().setLocation(loc);
  return loc;
}

export async function selectCurrentPosition(title: string): Promise<DeliveryLocation> {
  const pos = await getCurrentPosition();
  const s = await checkServiceability(pos.latitude, pos.longitude);
  const a = pos.address;
  const loc: DeliveryLocation = {
    source: 'gps',
    addressId: null,
    title,
    subtitle: a
      ? [a.area, a.city].filter(Boolean).join(', ')
      : `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`,
    latitude: pos.latitude,
    longitude: pos.longitude,
    serviceable: s.serviceable,
    etaMinutes: s.eta_minutes,
    checkedAt: now(),
  };
  useDeliveryLocation.getState().setLocation(loc);
  return loc;
}
