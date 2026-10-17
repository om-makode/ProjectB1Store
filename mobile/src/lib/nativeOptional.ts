import { requireOptionalNativeModule } from 'expo';
import { TurboModuleRegistry } from 'react-native';

/**
 * Native modules added after the current dev build was made are missing until the app is
 * rebuilt. Requiring their JS package then throws (and Metro reports it even if caught), so
 * check the native side first and load the package lazily.
 */
export function hasExpoModule(name: string): boolean {
  try {
    return !!requireOptionalNativeModule(name);
  } catch {
    return false;
  }
}

export function hasTurboModule(name: string): boolean {
  try {
    return !!TurboModuleRegistry.get(name);
  } catch {
    return false;
  }
}
