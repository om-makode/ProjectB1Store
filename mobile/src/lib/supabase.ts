import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { envResult } from '@/config/env';
import type { Database } from '@/types/database';

import { supabaseAuthStorage } from './authStorage';
import { AppError } from './errors';

let client: SupabaseClient<Database> | null = null;

/**
 * The one Supabase client. Created lazily so a missing .env shows a friendly error
 * screen instead of crashing at import time.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  if (!envResult.ok) throw new AppError('config', envResult.message);

  client = createClient<Database>(envResult.env.supabaseUrl, envResult.env.supabaseAnonKey, {
    auth: {
      ...(supabaseAuthStorage ? { storage: supabaseAuthStorage } : {}), // web: default localStorage
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
    global: { headers: { 'x-client-info': `nearkart-${Platform.OS}` } },
  });

  // Refresh tokens only while the app is in the foreground: timers don't run reliably
  // in the background on mobile, so stop/start explicitly.
  if (Platform.OS !== 'web') {
    const c = client;
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void c.auth.startAutoRefresh();
      else void c.auth.stopAutoRefresh();
    });
  }
  return client;
}
