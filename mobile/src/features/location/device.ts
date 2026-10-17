import { Platform } from 'react-native';

import { AppError } from '@/lib/errors';
import { hasExpoModule } from '@/lib/nativeOptional';

type LocationModule = typeof import('expo-location');

let mod: LocationModule | null | undefined;
function load(): LocationModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS !== 'web' && !hasExpoModule('ExpoLocation')) return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-location') as LocationModule;
  } catch {
    mod = null;
  }
  return mod;
}

/** False on a dev build made before expo-location was added (rebuild with `npx expo run:ios`). */
export const isLocationAvailable = () => load() !== null;

export type DeviceAddress = {
  house: string;
  area: string;
  city: string;
  pincode: string;
  landmark: string;
};

export type DevicePosition = { latitude: number; longitude: number; address: DeviceAddress | null };

/** Asks permission only now (when the user tapped "Use current location"). */
export async function getCurrentPosition(): Promise<DevicePosition> {
  const L = load();
  if (!L) throw new AppError('config', 'LOCATION_UNAVAILABLE', 'LOCATION_UNAVAILABLE');
  const perm = await L.requestForegroundPermissionsAsync();
  if (!perm.granted) throw new AppError('forbidden', 'LOCATION_DENIED', 'LOCATION_DENIED');
  const pos = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced });
  const { latitude, longitude } = pos.coords;
  let address: DeviceAddress | null = null;
  try {
    const [g] = await L.reverseGeocodeAsync({ latitude, longitude });
    if (g) {
      address = {
        house: [g.streetNumber, g.name !== g.street ? g.name : null].filter(Boolean).join(', '),
        area: [g.street, g.district].filter(Boolean).join(', '),
        city: g.city ?? g.subregion ?? '',
        pincode: g.postalCode ?? '',
        landmark: '',
      };
    }
  } catch {
    // Reverse geocoding is best-effort (offline / no geocoder): the user types the address.
  }
  return { latitude, longitude, address };
}
