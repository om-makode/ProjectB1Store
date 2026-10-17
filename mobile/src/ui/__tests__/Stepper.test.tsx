import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test-utils';

import { Stepper } from '../Stepper';
import * as Toast from '../Toast';

const handlers = () => ({ onAdd: jest.fn(), onIncrement: jest.fn(), onDecrement: jest.fn() });

describe('Stepper', () => {
  it('shows ADD at 0 and calls onAdd', async () => {
    const h = handlers();
    await renderWithProviders(<Stepper quantity={0} max={5} {...h} />);
    await fireEvent.press(screen.getByText('ADD'));
    expect(h.onAdd).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', async () => {
    const h = handlers();
    await renderWithProviders(<Stepper quantity={0} max={5} disabled {...h} />);
    await fireEvent.press(screen.getByTestId('stepper-add'));
    expect(h.onAdd).not.toHaveBeenCalled();
  });

  it('shows the quantity and increments/decrements', async () => {
    const h = handlers();
    await renderWithProviders(<Stepper quantity={2} max={5} {...h} />);
    expect(screen.getByTestId('stepper-quantity')).toHaveTextContent('2');
    await fireEvent.press(screen.getByTestId('stepper-increment'));
    await fireEvent.press(screen.getByTestId('stepper-decrement'));
    expect(h.onIncrement).toHaveBeenCalledTimes(1);
    expect(h.onDecrement).toHaveBeenCalledTimes(1);
  });

  it('blocks + at max and shows a toast', async () => {
    const h = handlers();
    const spy = jest.spyOn(Toast, 'showToast');
    await renderWithProviders(<Stepper quantity={5} max={5} {...h} />);
    await fireEvent.press(screen.getByTestId('stepper-increment'));
    expect(h.onIncrement).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith('You can add up to 5 of this item', 'warning');
  });
});
