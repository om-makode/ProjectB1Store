import { summarize, useGuestCart } from '../store';

const milk = {
  variantId: 19,
  productId: 15,
  slug: 'amul-taaza-toned-milk',
  name: { en: 'Amul Taaza' },
  label: { en: '500 ml' },
  thumbPath: null,
  isVeg: true,
  price: 27,
  mrp: 29,
  maxQty: 3,
};

beforeEach(() => useGuestCart.getState().clear());

describe('guest cart', () => {
  it('adds, increments up to the limit, and decrements to removal', () => {
    const c = useGuestCart.getState();
    c.add(milk);
    c.increment(19);
    c.increment(19);
    c.increment(19); // over max (3): ignored
    expect(useGuestCart.getState().lines[19]?.qty).toBe(3);
    c.decrement(19);
    c.decrement(19);
    c.decrement(19);
    expect(useGuestCart.getState().lines[19]).toBeUndefined();
  });

  it('never adds an out-of-stock item', () => {
    useGuestCart.getState().add({ ...milk, maxQty: 0 });
    expect(useGuestCart.getState().lines).toEqual({});
  });

  it('sync lowers quantity when stock drops, keeps the line when it runs out', () => {
    const c = useGuestCart.getState();
    c.add(milk);
    c.increment(19);
    c.increment(19);
    c.sync(19, { price: 28, mrp: 29, maxQty: 1 });
    expect(useGuestCart.getState().lines[19]).toMatchObject({ qty: 1, price: 28 });
    c.sync(19, { price: 28, mrp: 29, maxQty: 0 });
    expect(useGuestCart.getState().lines[19]?.qty).toBe(1);
  });

  it('summarizes count, total and MRP total', () => {
    const c = useGuestCart.getState();
    c.add(milk);
    c.increment(19);
    expect(summarize(useGuestCart.getState().lines)).toEqual({ count: 2, total: 54, mrpTotal: 58 });
  });
});
