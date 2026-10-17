import { discountPercent, formatPrice, formatQuantity } from '../format';

describe('formatPrice', () => {
  it('uses Indian grouping', () => {
    expect(formatPrice(100000)).toBe('₹1,00,000');
    expect(formatPrice(12345678)).toBe('₹1,23,45,678');
    expect(formatPrice(999)).toBe('₹999');
  });
  it('shows paise only when non-zero', () => {
    expect(formatPrice(42.5)).toBe('₹42.50');
    expect(formatPrice(42)).toBe('₹42');
  });
});

describe('discountPercent', () => {
  it('rounds down', () => {
    expect(discountPercent(45, 50)).toBe(10);
    expect(discountPercent(27, 29)).toBe(6);
  });
  it('is 0 without a discount', () => {
    expect(discountPercent(50, 50)).toBe(0);
    expect(discountPercent(60, 50)).toBe(0);
    expect(discountPercent(10, 0)).toBe(0);
  });
});

it('formatQuantity', () => {
  expect(formatQuantity(500, 'g')).toBe('500 g');
});
