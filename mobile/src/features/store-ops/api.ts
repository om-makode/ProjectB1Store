import { unwrap } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { Enums, Tables } from '@/types/helpers';
import { uniqueTopic } from '@/lib/realtimeTopic';

type Fns = Database['public']['Functions'];
export type BoardOrder = Fns['staff_list_board']['Returns'][number];
export type StockRow = Fns['staff_list_stock']['Returns'][number];
export type OrderStatus = Enums<'order_status'>;
export type StockReason = Enums<'stock_reason'>;
export type IssueStatus = Enums<'issue_status'>;

export type TodaySummary = {
  orders: number;
  delivered: number;
  cancelled: number;
  auto_cancelled: number;
  revenue: number;
  cod_collected: number;
  cod_outstanding: number;
  avg_accept_sec: number | null;
  avg_pack_sec: number | null;
};

/** Board columns, in the order staff work through them. 'done' = delivered/cancelled today. */
export const COLUMNS = ['new', 'accepted', 'packing', 'ready', 'out', 'done'] as const;
export type Column = (typeof COLUMNS)[number];

export const columnOf = (s: OrderStatus): Column | null => {
  switch (s) {
    case 'placed':
      return 'new';
    case 'confirmed':
      return 'accepted';
    case 'packing':
      return 'packing';
    case 'packed':
      return 'ready';
    case 'out_for_delivery':
      return 'out';
    case 'delivered':
    case 'cancelled':
      return 'done';
    default:
      return null; // e.g. awaiting_payment never reaches the board
  }
};

/** Same reasons as staff_mark_item_unavailable() (each changes stock differently on the server). */
export const UNAVAILABLE_REASONS = ['not_found', 'damaged', 'expired', 'customer_request'] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const STORE_CANCEL_REASONS = [
  'out_of_stock',
  'store_busy',
  'cannot_deliver',
  'customer_unreachable',
  'suspected_fake',
] as const;

export const listBoard = async (storeId: number): Promise<BoardOrder[]> =>
  (await unwrap(getSupabase().rpc('staff_list_board', { p_store_id: storeId }))) ?? [];

export const todaySummary = async (storeId: number): Promise<TodaySummary | null> =>
  (await unwrap(
    getSupabase().rpc('staff_today_summary', { p_store_id: storeId }),
  )) as unknown as TodaySummary | null;

export type Transition = Tables<'order_status_transitions'>;
export const listTransitions = async (): Promise<Transition[]> =>
  (await unwrap(getSupabase().from('order_status_transitions').select('*'))) ?? [];

export const setOrderStatus = (orderId: string, status: OrderStatus, note?: string) =>
  unwrap(
    getSupabase().rpc('staff_set_order_status', {
      p_order_id: orderId,
      p_status: status,
      p_note: note ?? undefined,
    }),
  );

export const togglePicked = (orderItemId: number, picked: boolean) =>
  unwrap(
    getSupabase().rpc('staff_toggle_picked', { p_order_item_id: orderItemId, p_picked: picked }),
  );

export const markItemUnavailable = (orderItemId: number, reason: UnavailableReason) =>
  unwrap(
    getSupabase().rpc('staff_mark_item_unavailable', {
      p_order_item_id: orderItemId,
      p_reason: reason,
    }),
  );

export const setOrderNote = (orderId: string, note: string) =>
  unwrap(getSupabase().rpc('staff_set_order_note', { p_order_id: orderId, p_note: note }));

export type StockFilter = 'all' | 'low' | 'out' | 'off';
export const listStock = async (
  storeId: number,
  filter: StockFilter,
  q: string,
  page: number,
): Promise<StockRow[]> =>
  (await unwrap(
    getSupabase().rpc('staff_list_stock', {
      p_store_id: storeId,
      p_filter: filter,
      p_q: q.trim() || undefined,
      p_page: page,
    }),
  )) ?? [];

export const adjustStock = (
  storeId: number,
  variantId: number,
  delta: number,
  reason: StockReason,
  note?: string,
) =>
  unwrap(
    getSupabase().rpc('staff_adjust_stock', {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_delta: delta,
      p_reason: reason,
      p_note: note,
    }),
  );

export const setStock = (storeId: number, variantId: number, stock: number, note?: string) =>
  unwrap(
    getSupabase().rpc('staff_set_stock', {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_stock: stock,
      p_note: note,
    }),
  );

export const setAvailable = (storeId: number, variantId: number, available: boolean) =>
  unwrap(
    getSupabase().rpc('staff_set_available', {
      p_store_id: storeId,
      p_variant_id: variantId,
      p_available: available,
    }),
  );

export const receiveStock = (
  storeId: number,
  items: { variant_id: number; qty: number }[],
  note?: string,
) =>
  unwrap(
    getSupabase().rpc('staff_receive_stock', { p_store_id: storeId, p_items: items, p_note: note }),
  );

export type StoreSettings = Pick<
  Tables<'stores'>,
  'id' | 'is_accepting_orders' | 'busy_message' | 'eta_minutes' | 'auto_cancel_minutes'
>;
export const fetchStoreSettings = async (storeId: number): Promise<StoreSettings> =>
  unwrap(
    getSupabase()
      .from('stores')
      .select('id, is_accepting_orders, busy_message, eta_minutes, auto_cancel_minutes')
      .eq('id', storeId)
      .single(),
  );

export const setStoreOpen = (
  storeId: number,
  accepting: boolean,
  busyMessage: Record<string, string> | null,
  etaMinutes: number | null,
) =>
  unwrap(
    getSupabase().rpc('staff_set_store_open', {
      p_store_id: storeId,
      p_accepting: accepting,
      p_busy_message: busyMessage ?? undefined,
      p_eta_minutes: etaMinutes ?? undefined,
    }),
  );

export type StaffIssue = Tables<'order_issues'> & {
  orders: { order_number: string; address_snapshot: unknown } | null;
};
export const listOpenIssues = async (): Promise<StaffIssue[]> =>
  (await unwrap(
    getSupabase()
      .from('order_issues')
      .select('*, orders(order_number, address_snapshot)')
      .eq('status', 'open')
      .order('created_at', { ascending: true }),
  )) as unknown as StaffIssue[];

export const resolveIssue = (issueId: number, status: Exclude<IssueStatus, 'open'>, note: string) =>
  unwrap(
    getSupabase().rpc('staff_resolve_issue', {
      p_issue_id: issueId,
      p_status: status,
      p_note: note,
    }),
  );

/** Issue photos live in the private `issues` bucket: staff read them through short-lived links. */
export async function issuePhotoUrl(path: string): Promise<string | null> {
  const { data } = await getSupabase().storage.from('issues').createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/**
 * Live board: any insert/update on this store's orders (staff RLS lets these through).
 * Events are hints; the board refetches. Returns an unsubscribe function.
 */
export function subscribeStoreOrders(
  storeId: number,
  handlers: {
    onChange: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
    onReconnect: () => void;
  },
): () => void {
  const supabase = getSupabase();
  let subscribedOnce = false;
  const channel = supabase
    .channel(uniqueTopic(`store-orders:${storeId}`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
      (payload) =>
        handlers.onChange(
          payload.eventType,
          (payload.new ?? payload.old ?? {}) as Record<string, unknown>,
        ),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (subscribedOnce) handlers.onReconnect();
        subscribedOnce = true;
      }
    });
  return () => void supabase.removeChannel(channel);
}
