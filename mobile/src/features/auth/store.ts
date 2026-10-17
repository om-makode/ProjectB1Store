import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

/** In-memory mirror of the Supabase session (supabase-js persists it securely itself). */
type AuthState = {
  ready: boolean; // the stored session has been read on startup
  session: Session | null;
  setSession: (s: Session | null) => void;
};

export const useAuth = create<AuthState>()((set) => ({
  ready: false,
  session: null,
  setSession: (session) => set({ session, ready: true }),
}));

export const useUserId = () => useAuth((s) => s.session?.user.id ?? null);
export const useIsLoggedIn = () => useAuth((s) => !!s.session);
