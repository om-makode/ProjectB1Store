import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { hasExpoModule } from '@/lib/nativeOptional';

import { uploadCatalogFile } from './api';

/** Image picking/resizing needs native modules on phones (present after a rebuild); web always works. */
export const canPickImages = () =>
  Platform.OS === 'web' ||
  (hasExpoModule('ExponentImagePicker') && hasExpoModule('ExpoImageManipulator'));

type Picked = { uri: string; width: number };

/** Let the admin pick one or more images. Returns [] when cancelled; 'denied' without permission. */
export async function pickImages(multiple: boolean): Promise<Picked[] | 'denied'> {
  const ImagePicker = await import('expo-image-picker');
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 10 : 1,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({ uri: a.uri, width: a.width ?? 0 }));
}

type Format = 'webp' | 'jpeg';

async function render(src: Picked, width: number, format: Format, square: boolean) {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const ctx = ImageManipulator.manipulate(src.uri);
  if (square) ctx.resize({ width, height: width });
  // Width only keeps the aspect ratio. Don't pass `height: null`: the web implementation treats
  // null as a height of 0 and the browser throws "Failed to execute 'createImageData'".
  else if (src.width > width) ctx.resize({ width });
  const img = await ctx.renderAsync();
  const saved = await img.saveAsync({
    format: format === 'webp' ? SaveFormat.WEBP : SaveFormat.JPEG,
    compress: format === 'webp' ? 0.75 : 0.8,
  });
  return saved.uri;
}

// WebP on phones; JPEG on web, where canvas WebP encoding isn't available in every browser.
const mainFormat = (): Format => (Platform.OS === 'web' ? 'jpeg' : 'webp');
const ext = (f: Format) => (f === 'webp' ? 'webp' : 'jpg');
const mime = (f: Format) => (f === 'webp' ? 'image/webp' : 'image/jpeg');

export type UploadedProductImage = { path: string; thumb_path: string };

/**
 * One product photo → catalog/products/<uuid>_full (1080 px) + _thumb (300 px), and for the first
 * image also <uuid>_share.jpg (600×600 JPEG; WhatsApp previews WebP unreliably; Phase 8 uses it).
 */
export async function uploadProductImage(
  src: Picked,
  withShare: boolean,
): Promise<UploadedProductImage> {
  const id = randomUUID();
  const f = mainFormat();
  const full = await render(src, 1080, f, false);
  const thumb = await render(src, 300, f, false);
  const path = await uploadCatalogFile(`products/${id}_full.${ext(f)}`, full, mime(f));
  const thumb_path = await uploadCatalogFile(`products/${id}_thumb.${ext(f)}`, thumb, mime(f));
  if (withShare) {
    const share = await render(src, 600, 'jpeg', true);
    await uploadCatalogFile(`products/${id}_share.jpg`, share, 'image/jpeg');
  }
  return { path, thumb_path };
}

/** Category tile, banner or collection image: one resized file under `folder/`. */
export async function uploadSimpleImage(
  src: Picked,
  folder: 'categories' | 'banners' | 'collections' | 'brands',
  width: number,
): Promise<string> {
  const f = mainFormat();
  const uri = await render(src, width, f, false);
  return uploadCatalogFile(`${folder}/${randomUUID()}.${ext(f)}`, uri, mime(f));
}
