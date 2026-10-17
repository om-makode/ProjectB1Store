import { Platform } from 'react-native';

import { envResult } from '@/config/env';
import { hasTurboModule } from '@/lib/nativeOptional';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

let mod: GoogleModule | null | undefined;
function load(): GoogleModule | null {
  if (mod !== undefined) return mod;
  const env = envResult.ok ? envResult.env : null;
  const configured = !!env?.googleWebClientId && (Platform.OS !== 'ios' || !!env.googleIosClientId);
  if (Platform.OS === 'web' || !configured || !hasTurboModule('RNGoogleSignin'))
    return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-google-signin/google-signin') as GoogleModule;
    mod.GoogleSignin.configure({
      webClientId: env!.googleWebClientId,
      iosClientId: env!.googleIosClientId,
    });
  } catch {
    mod = null;
  }
  return mod;
}

/** Google button is shown only when client ids are set and the native module is in the build. */
export const isGoogleAvailable = () => load() !== null;

/** Returns Google's ID token, or null when the user cancelled. */
export async function getGoogleIdToken(): Promise<string | null> {
  const g = load();
  if (!g) return null;
  if (Platform.OS === 'android') await g.GoogleSignin.hasPlayServices();
  const res = await g.GoogleSignin.signIn();
  if (!g.isSuccessResponse(res)) return null;
  return res.data.idToken;
}

export async function googleSignOut() {
  try {
    await load()?.GoogleSignin.signOut();
  } catch {
    // not signed in with Google
  }
}
