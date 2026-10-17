import { useAuth } from '@/features/auth/store';

import type { QuoteLine } from '../api';
import { useGuestCart } from '../store';
import { cart, isCartIdle, lineFromQuote, reconcileFromQuote } from '../sync';

const mockSetQty = jest.fn(async (variant_id: number, quantity: number) => ({
  variant_id,
  quantity,
}));
jest.mock('../api', () => ({
  setCartQuantity: (id: number, q: number) => mockSetQty(id, q),
  mergeGuestCart: jest.fn(),
}));
jest.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('@/ui/Toast', () => ({ showToast: jest.fn() }));

const milk = {
  variantId: 19,
  productId: 7,
  slug: 'amul-taaza',
  name: { en: 'Amul Taaza' },
  label: { en: '500 ml' },
  thumbPath: null,
  isVeg: true,
  price: 27,
  mrp: 29,
  maxQty: 5,
};

const quoteLine = (over: Partial<QuoteLine> = {}): QuoteLine => ({
  variant_id: 19,
  product_id: 7,
  slug: 'amul-taaza',
  name: { en: 'Amul Taaza' },
  variant_label: { en: '500 ml' },
  is_veg: true,
  image_path: null,
  mrp: 29,
  price: 28,
  price_at_add: 27,
  quantity: 3,
  billable_quantity: 3,
  max_per_order: 10,
  stock_left: null,
  line_total: 84,
  line_mrp_total: 87,
  flags: [],
  ...over,
});

const login = (on: boolean) =>
  useAuth.setState({ session: on ? ({ user: { id: 'u1' } } as never) : null, ready: true });

beforeEach(() => {
  jest.useFakeTimers();
  mockSetQty.mockClear();
  useGuestCart.getState().clear();
  login(false);
});
afterEach(() => jest.useRealTimers());

describe('cart facade', () => {
  it('guests: changes stay on the phone, no server writes', () => {
    cart.add(milk);
    cart.increment(19);
    jest.runAllTimers();
    expect(useGuestCart.getState().lines[19]?.qty).toBe(2);
    expect(mockSetQty).not.toHaveBeenCalled();
  });

  it('logged in: rapid taps become one debounced write with the final quantity', async () => {
    login(true);
    cart.add(milk);
    cart.increment(19);
    cart.increment(19);
    expect(isCartIdle()).toBe(false);
    jest.advanceTimersByTime(400);
    await Promise.resolve();
    expect(mockSetQty).toHaveBeenCalledTimes(1);
    expect(mockSetQty).toHaveBeenCalledWith(19, 3);
  });

  it('does not overwrite local taps with a server quote while a write is pending', () => {
    login(true);
    cart.add(milk);
    reconcileFromQuote({ lines: [] } as never); // stale server cart: still empty
    expect(useGuestCart.getState().lines[19]?.qty).toBe(1);
  });
});

describe('lineFromQuote', () => {
  it('caps by low stock, and marks out-of-stock lines as not addable', () => {
    expect(lineFromQuote(quoteLine({ stock_left: 2, flags: ['low_stock'] })).maxQty).toBe(2);
    expect(lineFromQuote(quoteLine({ flags: ['out_of_stock'] })).maxQty).toBe(0);
    expect(lineFromQuote(quoteLine()).maxQty).toBe(10);
    expect(lineFromQuote(quoteLine()).price).toBe(28);
  });
});
