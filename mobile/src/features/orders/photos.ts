import { Platform } from 'react-native';

import { hasExpoModule } from '@/lib/nativeOptional';

/** Photo picking needs native modules on phones (present after the next rebuild); web always works. */
export const canAttachPhotos = () =>
  Platform.OS === 'web' ||
  (hasExpoModule('ExponentImagePicker') && hasExpoModule('ExpoImageManipulator'));

export type PickedPhoto = { uri: string; mimeType: 'image/webp' | 'image/jpeg' };

/**
 * Pick one photo and shrink it before upload (max 1280 px, ~150–300 KB), which also drops
 * EXIF location data. WebP on phones; JPEG on web, where WebP encoding isn't universal.
 * Returns null when the user cancels.
 */
export async function pickAndCompressPhoto(): Promise<PickedPhoto | 'denied' | null> {
  const ImagePicker = await import('expo-image-picker');
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
  });
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;

  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const ctx = ImageManipulator.manipulate(asset.uri);
  // Width only: `height: null` becomes 0 on web and the canvas throws.
  if ((asset.width ?? 0) > 1280) ctx.resize({ width: 1280 });
  const image = await ctx.renderAsync();
  const web = Platform.OS === 'web';
  const saved = await image.saveAsync({
    format: web ? SaveFormat.JPEG : SaveFormat.WEBP,
    compress: 0.7,
  });
  return { uri: saved.uri, mimeType: web ? 'image/jpeg' : 'image/webp' };
}
