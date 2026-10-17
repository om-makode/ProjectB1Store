import {
  activeCount,
  filtersKey,
  parseFilterConfig,
  priceRanges,
  setPrice,
  toggleAttr,
  toggleBrand,
  toggleFlag,
} from '../filters';

describe('filters', () => {
  it('turns price buckets into ranges with an open top', () => {
    expect(priceRanges([0, 30, 60, 100])).toEqual([
      { min: 0, max: 30 },
      { min: 30, max: 60 },
      { min: 60, max: 100 },
      { min: 100 },
    ]);
  });

  it('price is single-choice and toggles off when tapped again', () => {
    const f = setPrice({}, { min: 30, max: 60 });
    expect(f).toEqual({ price_min: 30, price_max: 60 });
    expect(setPrice(f, { min: 100 })).toEqual({ price_min: 100 });
    expect(setPrice(f, { min: 30, max: 60 })).toEqual({});
  });

  it('brands and select attributes are multi-choice; empty lists are dropped', () => {
    let f = toggleBrand(toggleBrand({}, 1), 2);
    expect(f.brand_ids).toEqual([1, 2]);
    f = toggleBrand(toggleBrand(f, 1), 2);
    expect(f).toEqual({});
    f = toggleAttr(toggleAttr({}, 'milk_type', 'cow'), 'organic', true);
    expect(f.attrs).toEqual({ milk_type: ['cow'], organic: true });
    expect(toggleAttr(toggleAttr(f, 'milk_type', 'cow'), 'organic', true)).toEqual({});
  });

  it('counts active filters and builds an order-independent cache key', () => {
    const a = toggleFlag(toggleBrand(toggleBrand({}, 2), 1), 'veg');
    const b = toggleBrand(toggleBrand(toggleFlag({}, 'veg'), 1), 2);
    expect(activeCount(a)).toBe(3);
    expect(filtersKey(a)).toBe(filtersKey(b));
  });

  it('parses admin config defensively', () => {
    expect(
      parseFilterConfig([
        { type: 'brand' },
        { type: 'price', buckets: [0, 50] },
        { type: 'attribute', key: 'organic', quick: true },
        { type: 'price', buckets: 'bad' },
        { type: 'unknown' },
        null,
      ]),
    ).toEqual([
      { type: 'brand' },
      { type: 'price', buckets: [0, 50] },
      { type: 'attribute', key: 'organic', quick: true },
    ]);
    expect(parseFilterConfig(null)).toEqual([]);
  });
});
