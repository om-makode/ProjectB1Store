import { fireEvent, screen } from '@testing-library/react-native';
import { Button } from 'react-native';

import * as confirmModule from '@/lib/confirm';
import { renderWithProviders } from '@/test-utils';
import { useUnsavedChanges } from '../useUnsavedChanges';

jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: jest.fn(() => jest.fn()),
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
}));

function TestComponent({
  isDirty,
  onResult,
}: {
  isDirty: boolean;
  onResult: (res: boolean) => void;
}) {
  const { promptDiscard } = useUnsavedChanges(isDirty);
  return (
    <Button
      testID="check-btn"
      title="Check"
      onPress={async () => {
        const canLeave = await promptDiscard();
        onResult(canLeave);
      }}
    />
  );
}

describe('useUnsavedChanges', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves true immediately without prompt when isDirty is false', async () => {
    const confirmSpy = jest.spyOn(confirmModule, 'confirmAction');
    const onResult = jest.fn();

    await renderWithProviders(<TestComponent isDirty={false} onResult={onResult} />);
    await fireEvent.press(screen.getByTestId('check-btn'));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('prompts the user with confirmAction when isDirty is true', async () => {
    const confirmSpy = jest
      .spyOn(confirmModule, 'confirmAction')
      .mockResolvedValueOnce(false);
    const onResult = jest.fn();

    await renderWithProviders(<TestComponent isDirty={true} onResult={onResult} />);
    await fireEvent.press(screen.getByTestId('check-btn'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Unsaved changes',
      'You have unsaved changes. Please save your changes before going back.',
      'Discard',
      'Keep editing',
    );
  });
});
