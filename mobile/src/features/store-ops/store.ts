import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { kv } from '@/lib/kv';

export type Paper = 'a4' | '80mm' | '58mm';

/** Per-device Store mode preferences (each counter tablet/laptop has its own printer). */
type StoreModeState = {
  paper: Paper;
  soundOn: boolean; // web needs a click to unlock; native plays whenever this is on
  setPaper: (p: Paper) => void;
  setSoundOn: (on: boolean) => void;
};

const storage: StateStorage = {
  getItem: (k) => kv.getString(k),
  setItem: (k, v) => kv.set(k, v),
  removeItem: (k) => kv.delete(k),
};

export const useStoreMode = create<StoreModeState>()(
  persist(
    (set) => ({
      paper: 'a4',
      soundOn: true,
      setPaper: (paper) => set({ paper }),
      setSoundOn: (soundOn) => set({ soundOn }),
    }),
    {
      name: 'store-mode',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: ({ paper, soundOn }) => ({ paper, soundOn }),
    },
  ),
);
