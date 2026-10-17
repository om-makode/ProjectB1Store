import { z } from 'zod';

const schema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  EXPO_PUBLIC_WEB_URL: z.url(),
  // Optional: Google sign-in shows only when these are set (Phase 3 setup in docs/required/NEXT_STEPS.md).
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: z.string().optional(),
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: z.string().optional(),
  // Optional: 'true' shows email + password login in development builds (test accounts only).
  EXPO_PUBLIC_DEV_PASSWORD_LOGIN: z.string().optional(),
});

export type Env = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  webUrl: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
  devPasswordLogin: boolean;
};

export type EnvResult = { ok: true; env: Env } | { ok: false; message: string };

export function parseEnv(raw: Record<string, string | undefined>): EnvResult {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    return {
      ok: false,
      message: `Missing or invalid env: ${fields}. Copy mobile/.env.example to mobile/.env and fill it in.`,
    };
  }
  return {
    ok: true,
    env: {
      supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: parsed.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      webUrl: parsed.data.EXPO_PUBLIC_WEB_URL,
      googleWebClientId: parsed.data.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
      googleIosClientId: parsed.data.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined,
      devPasswordLogin: parsed.data.EXPO_PUBLIC_DEV_PASSWORD_LOGIN === 'true',
    },
  };
}

// Expo inlines EXPO_PUBLIC_* at build time: reference each one explicitly (no dynamic process.env[key]).
export const envResult = parseEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_DEV_PASSWORD_LOGIN: process.env.EXPO_PUBLIC_DEV_PASSWORD_LOGIN,
});

/** Throws with a clear message when env is missing. Screens use `envResult` to show it gracefully. */
export function requireEnv(): Env {
  if (!envResult.ok) throw new Error(envResult.message);
  return envResult.env;
}
