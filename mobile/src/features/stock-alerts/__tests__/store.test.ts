import { flushPendingStockAlerts, toggleStockAlert, useStockAlerts } from '../store';

const mockSession = { value: false };
const mockSet = jest.fn(async () => true);
jest.mock('../api', () => ({
  hasSession: () => Promise.resolve(mockSession.value),
  setStockAlert: (...a: unknown[]) => mockSet(...(a as [])),
}));

beforeEach(() => {
  useStockAlerts.setState({ on: [], pending: [] });
  mockSet.mockClear();
  mockSession.value = false;
});

describe('Notify me', () => {
  it('keeps guest alerts on the phone and sends them after login', async () => {
    expect(await toggleStockAlert(42)).toBe('pending');
    expect(useStockAlerts.getState()).toMatchObject({ on: [42], pending: [42] });
    expect(mockSet).not.toHaveBeenCalled();

    mockSession.value = true;
    await flushPendingStockAlerts();
    expect(mockSet).toHaveBeenCalledWith(42, true);
    expect(useStockAlerts.getState()).toMatchObject({ on: [42], pending: [] });
  });

  it('saves straight to the server when logged in, and toggles off', async () => {
    mockSession.value = true;
    expect(await toggleStockAlert(7)).toBe('saved');
    expect(await toggleStockAlert(7)).toBe('removed');
    expect(mockSet).toHaveBeenNthCalledWith(2, 7, false);
    expect(useStockAlerts.getState().on).toEqual([]);
  });
});
