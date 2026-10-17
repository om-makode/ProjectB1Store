import { router, type Href } from 'expo-router';

/**
 * Go back after an action (save, send…). On web after a refresh or a deep link there is no
 * history, so router.back() would do nothing: replace with a sensible screen instead.
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
