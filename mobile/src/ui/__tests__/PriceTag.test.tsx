import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils';

import { PriceTag } from '../PriceTag';

describe('PriceTag', () => {
  it('shows price, struck MRP and discount', async () => {
    await renderWithProviders(<PriceTag price={45} mrp={50} />);
    expect(screen.getByTestId('price')).toHaveTextContent('₹45');
    expect(screen.getByTestId('mrp')).toHaveTextContent('₹50');
    expect(screen.getByTestId('discount')).toHaveTextContent('10% OFF');
  });

  it('hides MRP and tag when there is no discount', async () => {
    await renderWithProviders(<PriceTag price={50} mrp={50} />);
    expect(screen.queryByTestId('mrp')).toBeNull();
    expect(screen.queryByTestId('discount')).toBeNull();
  });
});
