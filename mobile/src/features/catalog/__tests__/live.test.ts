import { mergeOffer } from '../live';

const offer = {
  id: 1,
  label: { en: '1 kg' },
  mrp: 100,
  price: 80,
  discount_pct: 20,
  available_qty: 5,
  low_stock: false,
  max_per_order: 5,
};

describe('mergeOffer (same rules as v_variant_offers)', () => {
  it('returns the server offer when there is no live patch', () => {
    expect(mergeOffer(offer, undefined, undefined)).toBe(offer);
  });

  it('applies stock: low stock, out of stock, and the per-order cap', () => {
    const inv = (stock: number, is_available = true) => ({
      stock,
      is_available,
      low_stock_threshold: 5,
    });
    expect(mergeOffer(offer, inv(3), undefined)).toMatchObject({
      available_qty: 3,
      low_stock: true,
    });
    expect(mergeOffer(offer, inv(0), undefined)).toMatchObject({
      available_qty: 0,
      low_stock: false,
    });
    expect(mergeOffer(offer, inv(50), undefined)).toMatchObject({
      available_qty: 5,
      low_stock: false,
    });
    expect(mergeOffer(offer, inv(50, false), undefined).available_qty).toBe(0);
  });

  it('applies a price change and recomputes the discount', () => {
    const v = { price: 90, mrp: 100, max_per_order: 2, is_active: true };
    expect(mergeOffer(offer, undefined, v)).toMatchObject({
      price: 90,
      discount_pct: 10,
      available_qty: 2,
    });
    expect(mergeOffer(offer, undefined, { ...v, is_active: false }).available_qty).toBe(0);
  });
});
