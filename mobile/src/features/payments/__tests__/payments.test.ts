import { getSupabase } from '@/lib/supabase';
import { hasTurboModule } from '@/lib/nativeOptional';

import { createPayment, PaymentError } from '../api';
import { canOpenCheckout, openCheckout } from '../checkout';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));
jest.mock('@/lib/nativeOptional', () => ({ hasTurboModule: jest.fn(() => false) }));

const invoke = jest.fn();
(getSupabase as jest.Mock).mockReturnValue({ functions: { invoke } });

/** What supabase-js returns for a non-2xx Edge Function reply. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: {
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  },
});

const session = {
  keyId: 'rzp_test_x',
  razorpayOrderId: 'order_1',
  amountPaise: 41200,
  currency: 'INR' as const,
  orderNumber: 'NK-1',
  timeoutSeconds: 600,
  prefill: { name: '', email: '', contact: '' },
};

describe('payment Edge Function errors', () => {
  beforeEach(() => invoke.mockReset());

  it('passes the session through and sends only the order id', async () => {
    invoke.mockResolvedValue({ data: session, error: null });
    await expect(createPayment('o1')).resolves.toEqual(session);
    expect(invoke).toHaveBeenCalledWith('create-payment', { body: { orderId: 'o1' } });
  });

  it('maps "keys not set" and "function not deployed" to payments_not_configured', async () => {
    invoke.mockResolvedValueOnce(httpError(503, { error: 'payments_not_configured' }));
    await expect(createPayment('o1')).rejects.toMatchObject({ code: 'payments_not_configured' });
    invoke.mockResolvedValueOnce(httpError(404, { message: 'Requested function was not found' }));
    await expect(createPayment('o1')).rejects.toMatchObject({ code: 'payments_not_configured' });
  });

  it('keeps known server codes and treats a fetch failure as network', async () => {
    invoke.mockResolvedValueOnce(httpError(409, { error: 'hold_expired' }));
    await expect(createPayment('o1')).rejects.toMatchObject({ code: 'hold_expired' });
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'Failed to send a request' } });
    const e = await createPayment('o1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PaymentError);
    expect((e as PaymentError).code).toBe('network');
  });
});

describe('Razorpay Checkout availability', () => {
  it('on a build without react-native-razorpay, checkout is unavailable (never crashes)', async () => {
    (hasTurboModule as jest.Mock).mockReturnValue(false);
    expect(canOpenCheckout()).toBe(false);
    await expect(
      openCheckout(session, { name: 'NearKart', description: 'x', color: '#000' }),
    ).rejects.toMatchObject({ code: 'checkout_unavailable' });
  });
});
