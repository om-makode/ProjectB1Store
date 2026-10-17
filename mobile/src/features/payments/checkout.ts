import { Platform } from 'react-native';

import { hasTurboModule } from '@/lib/nativeOptional';

import { PaymentError, type CheckoutSuccess, type PaymentSession } from './api';

export type CheckoutDisplay = { name: string; description: string; color: string };

type Options = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: PaymentSession['prefill'];
  timeout: number;
  theme: { color: string };
};

const toOptions = (s: PaymentSession, d: CheckoutDisplay): Options => ({
  key: s.keyId,
  order_id: s.razorpayOrderId,
  amount: s.amountPaise,
  currency: s.currency,
  name: d.name,
  description: d.description,
  prefill: s.prefill,
  timeout: s.timeoutSeconds,
  theme: { color: d.color },
});

/**
 * Can this build open Razorpay Checkout? Web: always (script loaded on demand).
 * Native: only builds made after react-native-razorpay was added (needs a rebuild).
 */
export const canOpenCheckout = () => Platform.OS === 'web' || hasTurboModule('RNRazorpayCheckout');

/** Opens Razorpay Checkout. Resolves with the signed result; rejects with PaymentError. */
export async function openCheckout(
  session: PaymentSession,
  display: CheckoutDisplay,
): Promise<CheckoutSuccess> {
  const options = toOptions(session, display);
  if (Platform.OS === 'web') return openWeb(options);
  if (!hasTurboModule('RNRazorpayCheckout')) throw new PaymentError('checkout_unavailable');
  return openNative(options);
}

// ---------- native (react-native-razorpay) ----------

type NativeCheckout = {
  open: (o: Options) => Promise<CheckoutSuccess>;
};

async function openNative(options: Options): Promise<CheckoutSuccess> {
  // Required lazily, after the native check: the package throws at import without it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RazorpayCheckout = (require('react-native-razorpay') as { default: NativeCheckout })
    .default;
  try {
    return await RazorpayCheckout.open(options);
  } catch (e) {
    const err = (e ?? {}) as { code?: number; description?: string };
    // code 0 / "cancelled": the customer closed the sheet.
    if (err.code === 0 || /cancel/i.test(String(err.description ?? '')))
      throw new PaymentError('dismissed');
    throw new PaymentError('failed', describe(err.description));
  }
}

/** Android sometimes sends the error as a JSON string. */
function describe(d: unknown): string | undefined {
  if (typeof d !== 'string') return undefined;
  try {
    const j = JSON.parse(d) as { error?: { description?: string } };
    return j.error?.description ?? d;
  } catch {
    return d;
  }
}

// ---------- web (checkout.js) ----------

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

type WebRazorpay = new (o: Record<string, unknown>) => {
  open: () => void;
  on: (event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void) => void;
};

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  const w = globalThis as unknown as { Razorpay?: WebRazorpay; document?: Document };
  if (w.Razorpay) return Promise.resolve();
  if (!w.document) return Promise.reject(new PaymentError('checkout_unavailable'));
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = w.document!.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new PaymentError('network', 'Could not load Razorpay Checkout'));
    };
    w.document!.body.appendChild(s);
  });
  return scriptPromise;
}

async function openWeb(options: Options): Promise<CheckoutSuccess> {
  await loadScript();
  const Razorpay = (globalThis as unknown as { Razorpay: WebRazorpay }).Razorpay;
  return new Promise<CheckoutSuccess>((resolve, reject) => {
    let lastError: string | undefined;
    const rzp = new Razorpay({
      ...options,
      handler: (res: CheckoutSuccess) => resolve(res),
      modal: {
        // Closing after a failed attempt reports the failure; otherwise it's a plain dismiss.
        ondismiss: () =>
          reject(lastError ? new PaymentError('failed', lastError) : new PaymentError('dismissed')),
      },
    });
    // Checkout stays open after a failure so the customer can try another way.
    rzp.on('payment.failed', (r) => {
      lastError = r.error?.description;
    });
    rzp.open();
  });
}
