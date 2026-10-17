// Pure helpers shared by the payment functions. No Deno APIs here, so the same file
// runs under Deno (Edge Functions) and Node (tests/razorpay-core.test.mjs) via Web Crypto.

const enc = new TextEncoder();

/** HMAC-SHA256 of `message` with `secret`, as lowercase hex (Razorpay's signature format). */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare for signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(
  keySecret: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  if (!keySecret || !signature) return false;
  const expected = await hmacHex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`);
  return safeEqual(expected, signature.toLowerCase());
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). */
export async function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  if (!webhookSecret || !signature) return false;
  const expected = await hmacHex(webhookSecret, rawBody);
  return safeEqual(expected, signature.toLowerCase());
}

/** Rupees (numeric/string from Postgres) → integer paise. 412.5 → 41250. */
export function toPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid amount: ${rupees}`);
  return Math.round(n * 100);
}
