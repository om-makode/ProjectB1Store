import { Platform, Share } from 'react-native';

import { envResult } from '@/config/env';

/** Public link for a product: the web page (Phase 8 web/) or, in dev, the app's own /p/ route. */
export function productShareUrl(slug: string, base = envResult.ok ? envResult.env.webUrl : '') {
  return `${base.replace(/\/+$/, '')}/p/${encodeURIComponent(slug)}`;
}

export function shareText(name: string, price: string, url: string) {
  return `${name} · ${price}\n${url}`;
}

export type ShareResult = 'shared' | 'copied' | 'dismissed' | 'failed';

/**
 * Share a product: the OS share sheet on phones (WhatsApp etc.), the Web Share API in browsers
 * that have it, otherwise copy the link to the clipboard.
 */
export async function shareProduct(opts: {
  name: string;
  price: string;
  slug: string;
  title: string;
}): Promise<ShareResult> {
  const url = productShareUrl(opts.slug);
  const message = shareText(opts.name, opts.price, url);

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    try {
      if (nav?.share) {
        await nav.share({ title: opts.title, text: `${opts.name} · ${opts.price}`, url });
        return 'shared';
      }
      if (nav?.clipboard) {
        await nav.clipboard.writeText(message);
        return 'copied';
      }
    } catch (e) {
      // AbortError = the user closed the share sheet.
      return (e as { name?: string })?.name === 'AbortError' ? 'dismissed' : 'failed';
    }
    return 'failed';
  }

  try {
    const r = await Share.share(
      // iOS shows `url` as a rich link; Android only reads `message`.
      Platform.OS === 'ios' ? { message: `${opts.name} · ${opts.price}`, url } : { message },
      { dialogTitle: opts.title },
    );
    return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}
