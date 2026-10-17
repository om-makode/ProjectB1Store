import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils';

import { VegMark } from '../VegMark';

describe('VegMark', () => {
  it('renders nothing for non-food', async () => {
    await renderWithProviders(<VegMark isVeg={null} />);
    expect(screen.queryByTestId('veg-mark')).toBeNull();
    expect(screen.queryByTestId('non-veg-mark')).toBeNull();
  });

  it('labels veg and non-veg for screen readers', async () => {
    await renderWithProviders(<VegMark isVeg />);
    expect(screen.getByLabelText('Vegetarian')).toBeTruthy();
    await renderWithProviders(<VegMark isVeg={false} />);
    expect(screen.getByLabelText('Non-vegetarian')).toBeTruthy();
  });
});
