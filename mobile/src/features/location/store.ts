import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { kv } from '@/lib/kv';

/** Where the customer wants delivery. Kept on the phone so guests get it too. */
export type DeliveryLocation = {
  source: 'address' | 'gps';
  addressId: string | null;
  title: string; // "Home" / "Current location"
  subtitle: string; // "12 Rajapeth, Amravati"
  /** Null for a saved address without GPS (serviceability then comes from its pincode). */
  latitude: number | null;
  longitude: number | null;
  serviceable: boolean;
  etaMinutes: number | null;
  checkedAt: string;
};

type LocationState = {
  location: DeliveryLocation | null;
  setLocation: (l: DeliveryLocation | null) => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

export const useDeliveryLocation = create<LocationState>()(
  persist(
    (set) => ({
      location: null,
      setLocation: (location) => set({ location }),
    }),
    {
      name: 'delivery-location',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ location }) => ({ location }),
    },
  ),
);
