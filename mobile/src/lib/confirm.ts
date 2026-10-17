import { Alert, Platform } from 'react-native';

/**
 * Ask the user to confirm a (usually destructive) action. Resolves true when confirmed.
 * Alert.alert with buttons does nothing on web, so the browser's confirm() is used there.
 */
export function confirmAction(
  title: string,
  message: string | undefined,
  ok: string,
  cancel: string,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(message ? `${title}\n\n${message}` : title),
    );
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: ok, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
