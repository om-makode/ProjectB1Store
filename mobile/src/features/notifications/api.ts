import { asLocalized, type LocalizedString } from '@/i18n/localize';
import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Tables } from '@/types/helpers';

export type NotificationRow = Pick<
  Tables<'notifications'>,
  'id' | 'type' | 'data' | 'read_at' | 'created_at'
> & { title: LocalizedString; body: LocalizedString };

export const NOTIFICATIONS_PAGE = 20;

type Raw = Pick<
  Tables<'notifications'>,
  'id' | 'type' | 'title' | 'body' | 'data' | 'read_at' | 'created_at'
>;

export const toNotification = (r: Raw): NotificationRow => ({
  ...r,
  title: asLocalized(r.title),
  body: asLocalized(r.body),
});

/** RLS: own rows only. Newest first. */
export const fetchNotifications = async (page: number): Promise<NotificationRow[]> => {
  const rows = (await unwrap(
    getSupabase()
      .from('notifications')
      .select('id, type, title, body, data, read_at, created_at')
      .order('created_at', { ascending: false })
      .range(page * NOTIFICATIONS_PAGE, page * NOTIFICATIONS_PAGE + NOTIFICATIONS_PAGE - 1),
  )) as Raw[];
  return rows.map(toNotification);
};

export const fetchUnreadCount = async (): Promise<number> => {
  const { count, error } = await getSupabase()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
};

/** No ids = mark everything read. */
export const markNotificationsRead = async (ids?: number[]) =>
  unwrap(getSupabase().rpc('mark_notifications_read', ids ? { p_ids: ids } : {}));

export const registerPushToken = async (token: string, platform: 'android' | 'ios') =>
  unwrap(getSupabase().rpc('register_push_token', { p_token: token, p_platform: platform }));

export const unregisterPushToken = async (token: string) =>
  unwrap(getSupabase().rpc('unregister_push_token', { p_token: token }));

/** In-app route for a notification: the server puts it in data.url (e.g. /order/<id>). */
export function notificationHref(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.url === 'string' && d.url.startsWith('/')) {
    // Store-side links (Phase 6) aren't routes in the customer app yet.
    return d.url.startsWith('/store/') ? null : d.url;
  }
  if (typeof d.route === 'string' && d.route.startsWith('/')) return d.route;
  const link = linkHref(d.link);
  if (link) return link;
  if (typeof d.order_id === 'string') return `/order/${d.order_id}`;
  return null;
}

/** Campaign / price-drop links: { type: 'product'|'category'|'collection'|'search', value }. */
function linkHref(link: unknown): string | null {
  if (!link || typeof link !== 'object') return null;
  const { type, value } = link as { type?: unknown; value?: unknown };
  if (value == null || value === '') return null;
  const v = encodeURIComponent(String(value));
  switch (type) {
    case 'product':
      return `/product/${v}`;
    case 'category':
      return `/category/${v}`;
    case 'collection':
      return `/collection/${v}`;
    case 'search':
      return `/search?q=${v}`;
    default:
      return null;
  }
}
