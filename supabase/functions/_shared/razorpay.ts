// Razorpay REST client + Supabase helpers for the payment Edge Functions (Deno).
// Secrets (npx supabase secrets set …): RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
// RAZORPAY_WEBHOOK_SECRET, INTERNAL_CRON_SECRET. Nothing here works until they are set,
// and every function answers 503 `payments_not_configured` instead of failing obscurely.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export * from './razorpay-core.ts';

export const env = (name: string) => Deno.env.get(name) ?? '';

export const razorpayConfigured = () => !!env('RAZORPAY_KEY_ID') && !!env('RAZORPAY_KEY_SECRET');

export class RazorpayError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    description: string | undefined,
  ) {
    super(description ?? `Razorpay error ${status}`);
    this.name = 'RazorpayError';
  }
}

export async function rzp<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = 'Basic ' + btoa(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`);
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RazorpayError(res.status, body?.error?.code, body?.error?.description);
  return body as T;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

/** Service-role client: bypasses RLS. Only used after the caller has been checked. */
export const adminClient = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

/** The logged-in user behind the request's Authorization header, or null. */
export async function callerId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

/** Cron-called functions authenticate with the shared secret header (Vault internal_cron_secret). */
export const isInternalCall = (req: Request) =>
  !!env('INTERNAL_CRON_SECRET') && req.headers.get('x-internal-secret') === env('INTERNAL_CRON_SECRET');
