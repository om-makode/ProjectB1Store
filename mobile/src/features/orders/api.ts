import { randomUUID } from 'expo-crypto';

import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Enums, Tables } from '@/types/helpers';
import { uniqueTopic } from '@/lib/realtimeTopic';

export type OrderStatus = Enums<'order_status'>;
export type IssueType = Enums<'issue_type'>;

/** Statuses a customer still waits on (shown live at the top of the Orders tab). */
export const ACTIVE_STATUSES: OrderStatus[] = [
  'awaiting_payment',
  'placed',
  'confirmed',
  'packing',
  'packed',
  'out_for_delivery',
];
export const PAST_STATUSES: OrderStatus[] = ['delivered', 'cancelled'];

/** The customer-facing progress line (cancelled is shown separately). */
export const TIMELINE: OrderStatus[] = [
  'placed',
  'confirmed',
  'packing',
  'packed',
  'out_for_delivery',
  'delivered',
];

/** Same rule as cancel_order(): customers can cancel until packing starts. */
export const canCustomerCancel = (s: OrderStatus) =>
  s === 'awaiting_payment' || s === 'placed' || s === 'confirmed';

/** Same rule as report_order_issue(): delivered, within 48 hours. */
export const ISSUE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const canReportIssue = (
  o: Pick<Tables<'orders'>, 'status' | 'delivered_at'>,
  now = Date.now(),
) =>
  o.status === 'delivered' &&
  !!o.delivered_at &&
  now - new Date(o.delivered_at).getTime() < ISSUE_WINDOW_MS;

type ItemPreview = Pick<Tables<'order_items'>, 'name_snapshot' | 'quantity' | 'image_path'>;

export type OrderListItem = Pick<
  Tables<'orders'>,
  'id' | 'order_number' | 'status' | 'grand_total' | 'placed_at' | 'payment_method'
> & { order_items: ItemPreview[] };

const LIST_COLUMNS =
  'id, order_number, status, grand_total, placed_at, payment_method, order_items(name_snapshot, quantity, image_path)';

export const PAGE_SIZE = 15;

/**
 * Always filter by user: RLS shows customers only their own orders, but staff can read every
 * order (Phase 6), and their own Orders tab must still list only their purchases.
 */
export const fetchActiveOrders = async (uid: string): Promise<OrderListItem[]> =>
  (await unwrap(
    getSupabase()
      .from('orders')
      .select(LIST_COLUMNS)
      .eq('user_id', uid)
      .in('status', ACTIVE_STATUSES)
      .order('placed_at', { ascending: false }),
  )) as unknown as OrderListItem[];

export const fetchPastOrders = async (uid: string, page: number): Promise<OrderListItem[]> =>
  (await unwrap(
    getSupabase()
      .from('orders')
      .select(LIST_COLUMNS)
      .eq('user_id', uid)
      .in('status', PAST_STATUSES)
      .order('placed_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
  )) as unknown as OrderListItem[];

export type OrderItem = Tables<'order_items'>;
export type OrderEvent = Pick<
  Tables<'order_status_events'>,
  'id' | 'status' | 'note' | 'created_at'
>;
export type OrderStore = Pick<
  Tables<'stores'>,
  'id' | 'name' | 'address' | 'phone' | 'whatsapp' | 'gstin' | 'fssai_license'
>;
export type OrderDetail = Tables<'orders'> & {
  order_items: OrderItem[];
  order_status_events: OrderEvent[];
  stores: OrderStore | null;
};

export const fetchOrderDetail = async (id: string): Promise<OrderDetail> => {
  const o = (await unwrap(
    getSupabase()
      .from('orders')
      .select(
        '*, order_items(*), order_status_events(id, status, note, created_at), stores(id, name, address, phone, whatsapp, gstin, fssai_license)',
      )
      .eq('id', id)
      .single(),
  )) as unknown as OrderDetail;
  o.order_items.sort((a, b) => a.id - b.id);
  o.order_status_events.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return o;
};

export type OrderIssue = Pick<
  Tables<'order_issues'>,
  'id' | 'type' | 'message' | 'status' | 'resolution_note' | 'created_at' | 'order_item_id'
>;

export const fetchOrderIssues = async (orderId: string): Promise<OrderIssue[]> =>
  (await unwrap(
    getSupabase()
      .from('order_issues')
      .select('id, type, message, status, resolution_note, created_at, order_item_id')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false }),
  )) as unknown as OrderIssue[];

export const cancelOrder = async (orderId: string, reason: string) =>
  unwrap(getSupabase().rpc('cancel_order', { p_order_id: orderId, p_reason: reason }));

export type ReorderResult = {
  added: { variant_id: number; quantity: number; reduced: boolean }[];
  missing: { variant_id: number; name: unknown; label: unknown }[];
};

export const reorderToCart = async (orderId: string): Promise<ReorderResult> =>
  (await unwrap(
    getSupabase().rpc('reorder_to_cart', { p_order_id: orderId }),
  )) as unknown as ReorderResult;

/**
 * Uploads one already-compressed photo to the private `issues` bucket.
 * Path rule (bucket policy + report_order_issue): <user_id>/<order_id>/<uuid>.<ext>
 */
export async function uploadIssuePhoto(
  userId: string,
  orderId: string,
  file: { uri: string; mimeType: 'image/webp' | 'image/jpeg' },
): Promise<string> {
  const ext = file.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/${orderId}/${randomUUID()}.${ext}`;
  // fetch(uri) reads file:// on native and blob:/data: on web.
  const body = await (await fetch(file.uri)).arrayBuffer();
  await unwrap(
    getSupabase().storage.from('issues').upload(path, body, { contentType: file.mimeType }),
  );
  return path;
}

export const reportOrderIssue = async (input: {
  orderId: string;
  type: IssueType;
  message: string;
  orderItemId?: number | null;
  photoPaths: string[];
}) =>
  unwrap(
    getSupabase().rpc('report_order_issue', {
      p_order_id: input.orderId,
      p_type: input.type,
      p_message: input.message,
      ...(input.orderItemId ? { p_order_item_id: input.orderItemId } : {}),
      p_photo_paths: input.photoPaths,
    }),
  );

/**
 * Realtime hints for one user (plan §5): orders INSERT/UPDATE and new notifications.
 * Returns an unsubscribe function. `onReconnect` fires when the channel comes back after a drop.
 */
export function subscribeMyOrders(
  uid: string,
  handlers: {
    onOrderChange: () => void;
    onNotification: (row: Record<string, unknown>) => void;
    onReconnect: () => void;
    onError: (status: string) => void;
  },
): () => void {
  const supabase = getSupabase();
  let subscribedOnce = false;
  const channel = supabase
    .channel(uniqueTopic(`my-orders:${uid}`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${uid}` },
      () => handlers.onOrderChange(),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
      (payload) => handlers.onNotification(payload.new as Record<string, unknown>),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) handlers.onReconnect();
        subscribedOnce = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        handlers.onError(status);
      }
    });
  return () => void supabase.removeChannel(channel);
}
