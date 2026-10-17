# Phase 4: Cart & Checkout (COD)

> **Goal:** turn a cart into a **real order, safely**. Prices, fees and stock are always decided by the server, the last packet of milk goes to exactly one person, and a double-tap or a dropped network never creates two orders.
> **Duration:** about 1.5 weeks · **Depends on:** Phase 3 (login, addresses, serviceability), Phase 1 (catalog, inventory, `store_status`) · **Next:** Phase 5 (Live order tracking)

**Done when:**
- [ ] A guest can fill a cart (saved on the phone); after login it **merges** into the server cart without doubling quantities
- [ ] The same cart shows on two logged-in devices, live
- [ ] The cart is **re-quoted by the server** on open, on every quantity change and on every live price/stock change; changes are highlighted ("Price changed ₹40 → ₹42", "Only 1 left", "Out of stock")
- [ ] Bill details (item total, MRP savings, delivery fee, small-cart fee, packaging fee, grand total) always match `get_cart_quote()`; "Add ₹X more for free delivery" is shown when it applies
- [ ] Checkout blocks with a clear message in EN/MR/HI for every failure: closed store, outside area, below minimum, COD limit, blocked account, too many open orders, rate limit, price changed, stock changed
- [ ] **Race test:** 20 users try to buy the last unit at once → exactly **1** order succeeds, stock ends at 0, never negative
- [ ] **Idempotency test:** calling `place_order` twice with the same key returns the same order; tapping "Place order" twice creates one order
- [ ] `0400_cart_orders.sql` applies cleanly; pgTAP tests pass; `supabase gen types` re-run

| # | Heading | Output |
|---|---|---|
| 4.1 | Cart & order schema | Tables, enums use, RLS, order-number generator |
| 4.2 | Guest cart (MMKV) + server cart + merge | `set_cart_quantity`, `merge_guest_cart`, `fix_cart`, cart broadcast, `useCart*` hooks |
| 4.3 | Live cart quote | `private._quote`, `get_cart_quote`, `quote_guest_cart`, `useCartQuote` |
| 4.4 | Cart screen & bill details | `app/cart.tsx`, `CartLine`, `BillDetails`, `FreeDeliveryProgress`, `CartBar` |
| 4.5 | Checkout: address, COD, note | `checkout/address.tsx`, payment & note sections |
| 4.6 | `place_order` (locks, idempotency, limits) | `place_order()`, `usePlaceOrder` |
| 4.7 | Order placed screen | `app/order/placed.tsx` |
| 4.8 | Edge cases & error copy | Failure codes table (3 languages), recovery rules |

All SQL below goes into **one file**, `supabase/migrations/0400_cart_orders.sql`, **in the order shown** (4.1 → 4.2 → 4.3 → 4.6).

**Assumed from earlier phases:** enums `order_status`, `payment_method`, `payment_status`, `cancel_actor`, `order_item_status`, `stock_reason` (Phase 0); `public.set_updated_at()`; `profiles` (`role`, `is_blocked`, `cod_allowed`); `stores` (fees and limits listed in the plan, §8.2) with `id bigint`; `products`, `product_variants`, `product_images`, `inventory`; `public.store_status(p_store_id)` returning jsonb with at least `is_open`, `accepting`, `opens_at`, `message` (Phase 1); `addresses` and `private.serviceability_for_point()` (Phase 3).

---

## 4.1 Cart & order schema

**Goal:** tables that record exactly what was bought, at what price, from which stock, and who changed what, and that **customers cannot write to directly**.

**SQL**

```sql
-- ============================================================================
-- 0400_cart_orders.sql
-- Cart, orders, order items, status events, inventory movements,
-- quote + place_order RPCs.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The single store in v1. Multi-store later: pick by serviceability instead.
create or replace function private.default_store_id()
returns bigint
language sql
stable
set search_path = ''
as $$
  select s.id from public.stores s order by s.id limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

create table public.cart_items (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  variant_id    bigint not null references public.product_variants(id) on delete cascade,
  quantity      int not null check (quantity between 1 and 50),
  price_at_add  numeric(10,2) not null,     -- price the customer last saw; drives "price changed"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, variant_id)
);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

alter table public.cart_items enable row level security;

create policy "cart: read own"   on public.cart_items for select to authenticated using (user_id = (select auth.uid()));
create policy "cart: delete own" on public.cart_items for delete to authenticated using (user_id = (select auth.uid()));
-- Inserts/updates go through set_cart_quantity() / merge_guest_cart() so that
-- quantities are clamped and price_at_add is set by the server.
revoke insert, update on public.cart_items from anon, authenticated;
revoke all on public.cart_items from anon;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table private.order_counters (
  day   date primary key,
  last  int not null
);

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_number         text not null unique,                       -- NK-261016-0042
  user_id              uuid references public.profiles(id) on delete set null,   -- null after account deletion
  store_id             bigint not null references public.stores(id),
  address_id           uuid references public.addresses(id) on delete set null,
  address_snapshot     jsonb not null,                              -- address exactly as it was at checkout
  status               public.order_status not null default 'placed',
  payment_method       public.payment_method not null default 'cod',
  payment_status       public.payment_status not null default 'pending',
  item_total           numeric(10,2) not null check (item_total >= 0),
  mrp_total            numeric(10,2) not null check (mrp_total >= item_total),
  delivery_fee         numeric(10,2) not null default 0 check (delivery_fee >= 0),
  small_cart_fee       numeric(10,2) not null default 0 check (small_cart_fee >= 0),
  packaging_fee        numeric(10,2) not null default 0 check (packaging_fee >= 0),
  grand_total          numeric(10,2) not null,
  customer_note        text check (customer_note is null or char_length(customer_note) <= 300),
  staff_note           text,
  cancel_reason        text,
  cancelled_by         public.cancel_actor,
  idempotency_key      uuid not null,
  placed_at            timestamptz not null default now(),
  confirmed_at         timestamptz,
  packed_at            timestamptz,
  out_for_delivery_at  timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint orders_idempotency_unique unique (user_id, idempotency_key),
  constraint orders_grand_total_matches
    check (grand_total = item_total + delivery_fee + small_cart_fee + packaging_fee)
);

comment on column public.orders.grand_total is
  'Always item_total + fees. Any function that changes item_total (e.g. Phase 6 item unavailable) must recompute fees and grand_total in the same UPDATE.';

create index orders_user_placed_idx   on public.orders (user_id, placed_at desc);
create index orders_store_status_idx  on public.orders (store_id, status, placed_at desc);
create index orders_open_by_user_idx  on public.orders (user_id) where status not in ('delivered', 'cancelled');

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id                      bigint generated always as identity primary key,
  order_id                uuid not null references public.orders(id) on delete cascade,
  variant_id              bigint references public.product_variants(id) on delete set null,
  product_id              bigint references public.products(id) on delete set null,
  name_snapshot           jsonb not null,           -- {en,mr,hi} product name at purchase
  variant_label_snapshot  jsonb not null,           -- {en,mr,hi} "500 g"
  image_path              text,                     -- catalog thumb path at purchase
  mrp                     numeric(10,2) not null check (mrp >= 0),
  price                   numeric(10,2) not null check (price >= 0 and price <= mrp),
  gst_rate                numeric(4,2) not null default 0,
  hsn_code                text,
  quantity                int not null check (quantity > 0),
  line_total              numeric(10,2) not null check (line_total = price * quantity),
  status                  public.order_item_status not null default 'active',
  picked                  boolean not null default false,
  created_at              timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_variant_idx on public.order_items (variant_id);

create table public.order_status_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  status      public.order_status not null,
  note        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index order_status_events_order_idx on public.order_status_events (order_id, created_at);

create table public.inventory_movements (
  id          bigint generated always as identity primary key,
  store_id    bigint not null references public.stores(id),
  variant_id  bigint not null references public.product_variants(id) on delete cascade,
  delta       int not null check (delta <> 0),
  reason      public.stock_reason not null,
  order_id    uuid references public.orders(id) on delete set null,
  note        text,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index inventory_movements_variant_idx on public.inventory_movements (store_id, variant_id, created_at desc);
create index inventory_movements_order_idx   on public.inventory_movements (order_id);

-- ---------------------------------------------------------------------------
-- RLS: customers read their own; nobody writes directly.
-- (Phase 6 adds staff read/update policies and RPCs.)
-- ---------------------------------------------------------------------------

alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.order_status_events enable row level security;
alter table public.inventory_movements enable row level security;
alter table private.order_counters     enable row level security;

create policy "orders: read own" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "order_items: read own" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

create policy "order_status_events: read own" on public.order_status_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid())));

-- inventory_movements: no customer policy at all (staff policy in Phase 6).

revoke insert, update, delete on public.orders, public.order_items,
  public.order_status_events, public.inventory_movements from anon, authenticated;
revoke all on public.orders, public.order_items, public.order_status_events,
  public.inventory_movements from anon;

-- ---------------------------------------------------------------------------
-- Order number: NK-YYMMDD-#### (counter resets daily, IST)
-- ---------------------------------------------------------------------------

create or replace function private.next_order_number()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_n   int;
begin
  insert into private.order_counters as c (day, last)
  values (v_day, 1)
  on conflict (day) do update set last = c.last + 1
  returning c.last into v_n;

  return 'NK-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
end;
$$;

-- Address as it was at checkout (orders never change when the address is edited later)
create or replace function private.address_snapshot(a public.addresses)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'label', a.label, 'receiver_name', a.receiver_name, 'receiver_phone', a.receiver_phone,
    'house', a.house, 'area', a.area, 'landmark', a.landmark, 'city', a.city,
    'pincode', a.pincode, 'latitude', a.latitude, 'longitude', a.longitude
  );
$$;
```

**Why these choices**

| Choice | Reason |
|---|---|
| `price_at_add` on `cart_items` | The only way to tell the user "Price changed ₹40 → ₹42" is to remember what they saw. |
| Snapshots (`name_snapshot`, `price`, `gst_rate`, `hsn_code`, `address_snapshot`) | An order is a legal record. Editing a product or address later must not change past orders or invoices. |
| `orders_grand_total_matches` check | The total can never drift from its parts, whatever code touches it later. |
| `unique (user_id, idempotency_key)` | The database itself guarantees one order per checkout attempt. |
| `user_id … on delete set null` | Account deletion keeps the order (tax records) but removes the link to the person. |
| Counter table instead of a sequence | Numbers restart at 0001 each day, which staff find easy to say on the phone ("order forty-two"). The row lock on today's counter is microseconds; fine for one store. |
| No insert/update grants | Even a bug in a future RLS policy can't let the app write an order directly. |

---

## 4.2 Guest cart (MMKV) + server cart + merge

**Goal:** the ADD button works instantly for everyone. Guests keep the cart on the phone; logged-in users keep it on the server (same cart on every device). Logging in merges the two.

**SQL**

```sql
-- ---------------------------------------------------------------------------
-- set_cart_quantity: the ONLY way a logged-in app changes a cart line.
-- quantity <= 0 removes the line. Clamps to max_per_order, 50 and live stock.
-- ---------------------------------------------------------------------------

create or replace function public.set_cart_quantity(p_variant_id bigint, p_quantity int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_price    numeric(10,2);
  v_max      int;
  v_stock    int;
  v_qty      int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if coalesce(p_quantity, 0) <= 0 then
    delete from public.cart_items c where c.user_id = v_uid and c.variant_id = p_variant_id;
    return jsonb_build_object('variant_id', p_variant_id, 'quantity', 0);
  end if;

  select v.price, v.max_per_order,
         case when v.is_active and p.is_active and coalesce(i.is_available, false)
              then coalesce(i.stock, 0) else 0 end
    into v_price, v_max, v_stock
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.inventory i on i.variant_id = v.id and i.store_id = private.default_store_id()
  where v.id = p_variant_id;

  if not found then
    raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_stock <= 0 then
    raise exception 'OUT_OF_STOCK' using errcode = 'P0001';
  end if;

  v_qty := least(p_quantity, coalesce(v_max, 10), 50, v_stock);

  insert into public.cart_items as c (user_id, variant_id, quantity, price_at_add)
  values (v_uid, p_variant_id, v_qty, v_price)
  on conflict (user_id, variant_id)
  do update set quantity = excluded.quantity;        -- keep the old price_at_add on purpose

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'quantity', v_qty,
    'requested', p_quantity,
    'clamped', v_qty < p_quantity,
    'clamp_reason', case
      when v_qty < p_quantity and v_qty = v_stock then 'stock'
      when v_qty < p_quantity then 'max_per_order'
    end,
    'stock_left', v_stock,
    'max_per_order', v_max
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_guest_cart: items = [{variant_id, quantity}], called once after login.
-- Takes the larger quantity per variant (never doubles), ignores unknown or
-- inactive variants, clamps to limits. Stock is NOT checked here; the quote
-- flags it.
-- ---------------------------------------------------------------------------

create or replace function public.merge_guest_cart(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return 0;
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;

  insert into public.cart_items as c (user_id, variant_id, quantity, price_at_add)
  select v_uid, v.id, least(r.qty, coalesce(v.max_per_order, 10), 50), v.price
  from (
    select (e ->> 'variant_id')::bigint as variant_id, max((e ->> 'quantity')::int) as qty
    from jsonb_array_elements(p_items) e
    where (e ->> 'variant_id') ~ '^[0-9]+$' and (e ->> 'quantity') ~ '^[0-9]+$'
    group by 1
  ) r
  join public.product_variants v on v.id = r.variant_id and v.is_active
  join public.products p on p.id = v.product_id and p.is_active
  where r.qty > 0
  on conflict (user_id, variant_id)
  do update set quantity = greatest(c.quantity, excluded.quantity);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- fix_cart: one tap "Update cart" after a quote flagged problems.
-- Removes unavailable lines, lowers quantities to what can be sold, and
-- accepts current prices.
-- ---------------------------------------------------------------------------

create or replace function public.fix_cart()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  for r in
    select c.variant_id, v.price,
           least(c.quantity, coalesce(v.max_per_order, 10), 50,
                 case when v.is_active and p.is_active and coalesce(i.is_available, false)
                      then coalesce(i.stock, 0) else 0 end) as allowed
    from public.cart_items c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id
    left join public.inventory i on i.variant_id = c.variant_id and i.store_id = private.default_store_id()
    where c.user_id = v_uid
  loop
    if r.allowed <= 0 then
      delete from public.cart_items where user_id = v_uid and variant_id = r.variant_id;
    else
      update public.cart_items
         set quantity = r.allowed, price_at_add = r.price
       where user_id = v_uid and variant_id = r.variant_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.set_cart_quantity(bigint, int), public.merge_guest_cart(jsonb), public.fix_cart() from public, anon;
grant execute on function public.set_cart_quantity(bigint, int), public.merge_guest_cart(jsonb), public.fix_cart() to authenticated;

-- ---------------------------------------------------------------------------
-- Live cart across devices: private Realtime Broadcast on topic cart:<uid>.
-- (Broadcast instead of postgres_changes because DELETE events from
-- postgres_changes are not filtered by RLS and would reach every subscriber.)
-- ---------------------------------------------------------------------------

create or replace function private.broadcast_cart_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_variant bigint;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id; v_variant := old.variant_id;
  else
    v_user := new.user_id; v_variant := new.variant_id;
  end if;

  perform realtime.send(
    jsonb_build_object('op', tg_op, 'variant_id', v_variant),
    'changed',
    'cart:' || v_user::text,
    true                                   -- private channel: needs the policy below
  );
  return null;
end;
$$;

create trigger cart_items_broadcast
  after insert or update or delete on public.cart_items
  for each row execute function private.broadcast_cart_change();

create policy "realtime: own cart topic"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'cart:' || (select auth.uid())::text
  );
```

**Files**

```
mobile/src/features/cart/
  guestCart.ts          # Zustand + MMKV: { [variantId]: qty }
  api.ts                # setQuantity, mergeGuestCart, fixCart, fetchCartItems
  useCartItems.ts       # lightweight map variantId → qty (for ADD buttons)
  useSetCartQuantity.ts # optimistic + debounced per variant
  useCartRealtime.ts    # cart:<uid> broadcast + inventory/price channels → invalidate quote
  mergeOnLogin.ts       # post-login task
```

### Guest cart (`guestCart.ts`)

```ts
type GuestCart = {
  items: Record<number, number>;                 // variantId → quantity
  set: (variantId: number, qty: number) => void;
  clear: () => void;
};

export const useGuestCart = create<GuestCart>()(
  persist(
    (set) => ({
      items: {},
      set: (variantId, qty) =>
        set((s) => {
          const items = { ...s.items };
          if (qty <= 0) delete items[variantId];
          else items[variantId] = Math.min(qty, 50);
          return { items };
        }),
      clear: () => set({ items: {} }),
    }),
    { name: 'nk.guestCart', storage: createJSONStorage(() => mmkvStorage) },
  ),
);

export const guestItemsToJson = (items: Record<number, number>) =>
  Object.entries(items).map(([variant_id, quantity]) => ({ variant_id: Number(variant_id), quantity }));
```

### One API for the ADD button, logged in or not

Phase 1's `AddButton` only needs two things: the current quantity and a setter.

```ts
// useCartItems.ts: cheap map for every product card (not the full quote)
export function useCartItems() {
  const uid = useUserId();
  const guest = useGuestCart((s) => s.items);
  const server = useQuery({
    queryKey: ['cart', 'items', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('cart_items').select('variant_id, quantity');
      if (error) throw error;
      return Object.fromEntries(data.map((r) => [r.variant_id, r.quantity])) as Record<number, number>;
    },
  });
  return uid ? server.data ?? {} : guest;
}

export const useCartQuantity = (variantId: number) => useCartItems()[variantId] ?? 0;
```

```ts
// useSetCartQuantity.ts
const DEBOUNCE_MS = 300;    // collapse fast + + + taps into one RPC

export function useSetCartQuantity() {
  const uid = useUserId();
  const qc = useQueryClient();
  const setGuest = useGuestCart((s) => s.set);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  return useCallback((variantId: number, qty: number) => {
    Haptics.selectionAsync();
    if (!uid) { setGuest(variantId, qty); return; }

    // optimistic: ADD buttons and the cart bar update at once
    qc.setQueryData<Record<number, number>>(['cart', 'items', uid], (old = {}) => {
      const next = { ...old };
      if (qty <= 0) delete next[variantId]; else next[variantId] = qty;
      return next;
    });

    clearTimeout(timers.current.get(variantId));
    timers.current.set(variantId, setTimeout(async () => {
      const { data, error } = await supabase.rpc('set_cart_quantity', { p_variant_id: variantId, p_quantity: qty });
      if (error) {
        toast(t(errorKey(error)));                       // OUT_OF_STOCK → "This item just went out of stock"
      } else if (data?.clamped) {
        toast(data.clamp_reason === 'stock'
          ? t('cart.onlyNLeft', { n: data.stock_left })
          : t('cart.maxPerOrder', { n: data.max_per_order }));
      }
      qc.invalidateQueries({ queryKey: ['cart'] });      // items + quote refetch with server truth
    }, DEBOUNCE_MS));
  }, [uid]);
}
```

### Merge on login (`mergeOnLogin.ts`)

```ts
onSignedIn(async () => {
  const items = guestItemsToJson(useGuestCart.getState().items);
  if (items.length === 0) return;
  const { error } = await supabase.rpc('merge_guest_cart', { p_items: items });
  if (error) throw error;                 // keep the guest cart so nothing is lost; retried next login
  useGuestCart.getState().clear();
  queryClient.invalidateQueries({ queryKey: ['cart'] });
});
```

### Live updates (`useCartRealtime.ts`)

Mounted on the cart screen and in the floating cart bar host.

```ts
export function useCartRealtime() {
  const uid = useUserId();
  const qc = useQueryClient();
  const invalidate = useDebouncedCallback(() => qc.invalidateQueries({ queryKey: ['cart'] }), 500);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`cart:${uid}`, { config: { private: true } })
      .on('broadcast', { event: 'changed' }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid]);

  // Phase 1 channels: inventory:store=<id> and variants:prices. On the cart
  // screen, any change to a variant in the cart re-quotes.
  useRealtimeTopic('inventory', (row) => cartHasVariant(row.variant_id) && invalidate());
  useRealtimeTopic('variants', (row) => cartHasVariant(row.id) && invalidate());
}
```

Remember `supabase.realtime.setAuth(access_token)` (Phase 3.2) before subscribing to private channels.

**Checks**
- Guest adds 2 × milk, logs in on a phone where the server cart already has 3 × milk → cart shows **3**, not 5.
- Phone A changes quantity → phone B's cart updates within ~1 s.
- Tap + 6 times quickly → one `set_cart_quantity` call (network tab / Supabase logs).

**Tests**
- `guestCart` set/remove/limit 50.
- `useSetCartQuantity` debounces per variant (fake timers) and rolls back via refetch on error.

---

## 4.3 Live cart quote

**Goal:** one server function that prices the cart from **current** data and says exactly what's wrong, used for display (guest and logged in) and **reused inside `place_order`**, so what the customer sees and what they're charged can't differ.

**SQL**

```sql
-- ---------------------------------------------------------------------------
-- private._quote: pure pricing + validation. No writes.
--   p_items: [{variant_id, quantity, price_at_add?}]
--   p_user_id: null for guests
-- Returns jsonb (shape documented below).
-- ---------------------------------------------------------------------------

create or replace function private._quote(
  p_items           jsonb,
  p_user_id         uuid,
  p_address_id      uuid,
  p_payment_method  public.payment_method
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blockers      jsonb := '[]'::jsonb;
  v_addr          public.addresses%rowtype;
  v_service       jsonb;
  v_store_id      bigint;
  v_store         public.stores%rowtype;
  v_status        jsonb;
  v_profile       public.profiles%rowtype;
  v_lines         jsonb;
  v_item_total    numeric(10,2);
  v_mrp_total     numeric(10,2);
  v_item_count    int;
  v_needs_review  boolean;
  v_delivery      numeric(10,2) := 0;
  v_delivery_full numeric(10,2) := 0;
  v_small         numeric(10,2) := 0;
  v_packaging     numeric(10,2) := 0;
  v_grand         numeric(10,2);
  v_open_orders   int;
begin
  -- 1. Address → store ----------------------------------------------------
  if p_address_id is null then
    v_blockers := v_blockers || jsonb_build_object('code', 'ADDRESS_REQUIRED');
  else
    select * into v_addr
    from public.addresses a
    where a.id = p_address_id and a.user_id = p_user_id and a.deleted_at is null;

    if not found then
      v_blockers := v_blockers || jsonb_build_object('code', 'ADDRESS_NOT_FOUND');
    else
      v_service := private.serviceability_for_point(v_addr.location);
      if coalesce((v_service ->> 'serviceable')::boolean, false) then
        v_store_id := (v_service ->> 'store_id')::bigint;
      else
        v_blockers := v_blockers || jsonb_build_object(
          'code', 'NOT_SERVICEABLE', 'distance_km', v_service -> 'distance_km');
      end if;
    end if;
  end if;

  v_store_id := coalesce(v_store_id, private.default_store_id());
  select * into v_store from public.stores s where s.id = v_store_id;

  -- 2. Lines, priced from current data ------------------------------------
  with req as (
    select (e ->> 'variant_id')::bigint                          as variant_id,
           sum(greatest(coalesce((e ->> 'quantity')::int, 0), 0)) as quantity,
           max(nullif(e ->> 'price_at_add', '')::numeric)        as price_at_add
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    group by 1
  ),
  l as (
    select r.variant_id, v.product_id, p.slug, p.name, v.label, p.is_veg,
           img.thumb_path,
           v.mrp, v.price, r.price_at_add, r.quantity,
           coalesce(v.max_per_order, 10) as max_per_order,
           case when v.is_active and p.is_active and coalesce(i.is_available, false)
                then coalesce(i.stock, 0) else 0 end as stock,
           coalesce(i.low_stock_threshold, 5) as low_stock_threshold
    from req r
    join public.product_variants v on v.id = r.variant_id
    join public.products p on p.id = v.product_id
    left join public.inventory i on i.store_id = v_store_id and i.variant_id = v.id
    left join lateral (
      select pi.thumb_path
      from public.product_images pi
      where pi.product_id = p.id and (pi.variant_id is null or pi.variant_id = v.id)
      order by (pi.variant_id is null), pi.sort_order
      limit 1
    ) img on true
    where r.quantity > 0
  ),
  b as (
    select l.*, least(l.quantity, l.stock, l.max_per_order, 50) as billable
    from l
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'variant_id',        b.variant_id,
      'product_id',        b.product_id,
      'slug',              b.slug,
      'name',              b.name,
      'variant_label',     b.label,
      'is_veg',            b.is_veg,
      'image_path',        b.thumb_path,
      'mrp',               b.mrp,
      'price',             b.price,
      'price_at_add',      b.price_at_add,
      'quantity',          b.quantity,
      'billable_quantity', b.billable,
      'max_per_order',     b.max_per_order,
      'stock_left',        case when b.stock <= b.low_stock_threshold then b.stock end,  -- only shown when low
      'line_total',        b.price * b.billable,
      'line_mrp_total',    b.mrp * b.billable,
      'flags', to_jsonb(array_remove(array[
        case when b.stock = 0 then 'out_of_stock' end,
        case when b.stock > 0 and b.quantity > b.stock then 'low_stock' end,
        case when b.quantity > b.max_per_order then 'over_limit' end,
        case when b.price_at_add is not null and b.price_at_add <> b.price then 'price_changed' end
      ], null))
    ) order by b.variant_id), '[]'::jsonb),
    coalesce(sum(b.price * b.billable), 0),
    coalesce(sum(b.mrp * b.billable), 0),
    coalesce(sum(b.billable), 0),
    coalesce(bool_or(b.billable < b.quantity), false)
  into v_lines, v_item_total, v_mrp_total, v_item_count, v_needs_review
  from b;

  -- 3. Fees ------------------------------------------------------------------
  if v_item_total > 0 then
    v_delivery_full := coalesce(v_store.delivery_fee, 0);
    v_delivery := case
      when v_store.free_delivery_above is not null and v_item_total >= v_store.free_delivery_above then 0
      else v_delivery_full end;
    v_small := case
      when v_store.small_cart_threshold is not null and v_item_total < v_store.small_cart_threshold
      then coalesce(v_store.small_cart_fee, 0) else 0 end;
    v_packaging := coalesce(v_store.packaging_fee, 0);
  end if;
  v_grand := v_item_total + v_delivery + v_small + v_packaging;

  -- 4. Blockers --------------------------------------------------------------
  -- CART_EMPTY only when there are no lines at all. Lines that exist but can't
  -- be sold (stock 0) give CART_NEEDS_REVIEW, so the UI can show what changed.
  if jsonb_array_length(v_lines) = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'CART_EMPTY');
  end if;

  if v_needs_review then
    v_blockers := v_blockers || jsonb_build_object('code', 'CART_NEEDS_REVIEW');
  end if;

  v_status := public.store_status(v_store_id);
  if not coalesce((v_status ->> 'is_open')::boolean, false)
     or not coalesce((v_status ->> 'accepting')::boolean, false) then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'STORE_CLOSED', 'opens_at', v_status -> 'opens_at', 'message', v_status -> 'message');
  end if;

  if v_item_count > 0 and v_item_total < coalesce(v_store.min_order_value, 0) then
    v_blockers := v_blockers || jsonb_build_object(
      'code', 'BELOW_MIN_ORDER',
      'min_order_value', v_store.min_order_value,
      'amount_needed', v_store.min_order_value - v_item_total);
  end if;

  if p_payment_method <> 'cod' then
    v_blockers := v_blockers || jsonb_build_object('code', 'PAYMENT_METHOD_UNAVAILABLE');   -- until Phase 10
  end if;

  if p_user_id is null then
    v_blockers := v_blockers || jsonb_build_object('code', 'LOGIN_REQUIRED');
  else
    select * into v_profile from public.profiles pr where pr.id = p_user_id;

    if coalesce(v_profile.is_blocked, false) then
      v_blockers := v_blockers || jsonb_build_object('code', 'ACCOUNT_BLOCKED');
    end if;

    if p_payment_method = 'cod' then
      if not coalesce(v_profile.cod_allowed, true) then
        v_blockers := v_blockers || jsonb_build_object('code', 'COD_NOT_ALLOWED');
      elsif v_store.max_cod_order_value is not null and v_grand > v_store.max_cod_order_value then
        v_blockers := v_blockers || jsonb_build_object(
          'code', 'COD_LIMIT_EXCEEDED', 'max_cod_order_value', v_store.max_cod_order_value);
      end if;
    end if;

    select count(*) into v_open_orders
    from public.orders o
    where o.user_id = p_user_id and o.status not in ('delivered', 'cancelled');

    if v_store.max_open_orders_per_user is not null and v_open_orders >= v_store.max_open_orders_per_user then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'TOO_MANY_OPEN_ORDERS', 'max', v_store.max_open_orders_per_user);
    end if;
  end if;

  -- 5. Result ------------------------------------------------------------------
  return jsonb_build_object(
    'store_id',              v_store_id,
    'address_id',            case when v_addr.id is not null then v_addr.id end,
    'payment_method',        p_payment_method,
    'lines',                 v_lines,
    'item_count',            v_item_count,
    'item_total',            v_item_total,
    'mrp_total',             v_mrp_total,
    'savings',               v_mrp_total - v_item_total + (v_delivery_full - v_delivery),
    'delivery_fee',          v_delivery,
    'delivery_fee_waived',   v_delivery_full - v_delivery,
    'small_cart_fee',        v_small,
    'small_cart_threshold',  v_store.small_cart_threshold,
    'packaging_fee',         v_packaging,
    'grand_total',           v_grand,
    'free_delivery_above',   v_store.free_delivery_above,
    'add_for_free_delivery', case
        when v_store.free_delivery_above is not null and v_item_total > 0
         and v_item_total < v_store.free_delivery_above
        then v_store.free_delivery_above - v_item_total end,
    'min_order_value',       v_store.min_order_value,
    'eta_minutes',           coalesce((v_service ->> 'eta_minutes')::int, v_store.eta_minutes),
    'can_checkout',          jsonb_array_length(v_blockers) = 0,
    'blockers',              v_blockers,
    'quoted_at',             now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

create or replace function public.get_cart_quote(
  p_address_id     uuid default null,
  p_payment_method public.payment_method default 'cod'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', c.variant_id, 'quantity', c.quantity, 'price_at_add', c.price_at_add)), '[]'::jsonb)
    into v_items
  from public.cart_items c
  where c.user_id = v_uid;

  return private._quote(v_items, v_uid, p_address_id, p_payment_method);
end;
$$;

-- Guests: prices the phone's cart. Same rules, no user checks.
create or replace function public.quote_guest_cart(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 100 then
    raise exception 'CART_TOO_LARGE' using errcode = 'P0001';
  end if;
  return private._quote(coalesce(p_items, '[]'::jsonb), null, null, 'cod');
end;
$$;

revoke all on function public.get_cart_quote(uuid, public.payment_method) from public, anon;
grant execute on function public.get_cart_quote(uuid, public.payment_method) to authenticated;
revoke all on function public.quote_guest_cart(jsonb) from public;
grant execute on function public.quote_guest_cart(jsonb) to anon, authenticated;
```

### Quote shape (TypeScript)

Add to `src/features/cart/types.ts` (jsonb returns aren't typed by `supabase gen types`):

```ts
export type LineFlag = 'out_of_stock' | 'low_stock' | 'over_limit' | 'price_changed';

export type QuoteLine = {
  variant_id: number; product_id: number; slug: string;
  name: Localized; variant_label: Localized; is_veg: boolean | null; image_path: string | null;
  mrp: number; price: number; price_at_add: number | null;
  quantity: number; billable_quantity: number; max_per_order: number;
  stock_left: number | null; line_total: number; line_mrp_total: number; flags: LineFlag[];
};

export type BlockerCode =
  | 'ADDRESS_REQUIRED' | 'ADDRESS_NOT_FOUND' | 'NOT_SERVICEABLE' | 'CART_EMPTY' | 'CART_NEEDS_REVIEW'
  | 'STORE_CLOSED' | 'BELOW_MIN_ORDER' | 'PAYMENT_METHOD_UNAVAILABLE' | 'LOGIN_REQUIRED'
  | 'ACCOUNT_BLOCKED' | 'COD_NOT_ALLOWED' | 'COD_LIMIT_EXCEEDED' | 'TOO_MANY_OPEN_ORDERS';

export type Blocker = { code: BlockerCode } & Record<string, unknown>;

export type CartQuote = {
  store_id: number; address_id: string | null; payment_method: 'cod' | 'upi';
  lines: QuoteLine[]; item_count: number;
  item_total: number; mrp_total: number; savings: number;
  delivery_fee: number; delivery_fee_waived: number;
  small_cart_fee: number; small_cart_threshold: number | null; packaging_fee: number;
  grand_total: number; free_delivery_above: number | null; add_for_free_delivery: number | null;
  min_order_value: number | null; eta_minutes: number | null;
  can_checkout: boolean; blockers: Blocker[]; quoted_at: string;
};
```

> `numeric` values come back from PostgREST as JSON numbers inside `jsonb`. Display them with `formatINR()` (Phase 0) and never add money on the phone except for the optimistic "Updating…" state.

### `useCartQuote.ts`

```ts
export function useCartQuote() {
  const uid = useUserId();
  const addressId = useCheckout((s) => s.addressId);       // 4.5
  const guestItems = useGuestCart((s) => s.items);

  return useQuery({
    queryKey: uid ? ['cart', 'quote', uid, addressId ?? null] : ['cart', 'guest-quote', guestItems],
    queryFn: async (): Promise<CartQuote> => {
      const res = uid
        ? await supabase.rpc('get_cart_quote', { p_address_id: addressId ?? undefined, p_payment_method: 'cod' })
        : await supabase.rpc('quote_guest_cart', { p_items: guestItemsToJson(guestItems) });
      if (res.error) throw res.error;
      return res.data as unknown as CartQuote;
    },
    placeholderData: keepPreviousData,        // no flicker while re-quoting
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    networkMode: 'online',
  });
}
```

**Checks**
- Change a variant's price in Studio while the cart is open → the line shows "Price changed ₹40 → ₹42" and the total updates within ~1 s.
- Set stock to 1 while the cart has 3 → line shows "Only 1 left", `CART_NEEDS_REVIEW` blocker, "Update cart" button.
- Set the store's `free_delivery_above` to 199 with a ₹150 cart → "Add ₹49 more for FREE delivery".

**Tests:** pgTAP (end of this file) and unit tests for the quote → UI mapping (`blockerMessage()`, `lineBadges()`).

---

## 4.4 Cart screen & bill details

**Goal:** a Blinkit-style single-page cart and checkout: items, problems, bill, address, payment and one big button.

**Files**

```
mobile/app/cart.tsx
mobile/src/features/cart/components/
  CartBar.tsx              # floating "3 items · ₹245  View cart ›" (Phase 1 placeholder → real)
  CartLine.tsx             # image, veg mark, name, label, price/MRP, stepper, flag badges
  QuoteBanners.tsx         # blocker + flag summary banners
  BillDetails.tsx
  FreeDeliveryProgress.tsx
  SavingsStrip.tsx
  CheckoutFooter.tsx       # address row + pay button (4.5, 4.6)
```

### Layout

```
┌──────────────────────────────────────┐
│ ←  Cart                              │
│ ⚡ Delivery in ~20 min · 4 items      │
├──────────────────────────────────────┤
│ ⚠ Some items changed  [Update cart]  │  ← QuoteBanners (CART_NEEDS_REVIEW)
├──────────────────────────────────────┤
│ [img] Amul Taaza Milk     ₹27  [−1+] │
│       500 ml          ~~₹28~~        │
│       🔺 Price changed ₹26 → ₹27      │
│ [img] Bread               ₹40  [−2+] │
│       400 g    Only 1 left ⚠         │
│ [img] Eggs (6)       Out of stock ✕  │  ← greyed, "Remove"
├──────────────────────────────────────┤
│ 🚚 Add ₹55 more for FREE delivery    │  ← FreeDeliveryProgress (bar)
├──────────────────────────────────────┤
│ Bill details                         │
│ Item total          ~~₹160~~  ₹145   │
│ Delivery fee                  ₹25    │
│ Small cart fee ⓘ              ₹15    │
│ Packaging                     ₹ 5    │
│ ──────────────────────────────────── │
│ Grand total                  ₹190    │
│ 🎉 You save ₹15 on this order         │  ← SavingsStrip
├──────────────────────────────────────┤
│ Note for store  [Need change for ₹500]│ ← chips + text (4.5)
├──────────────────────────────────────┤
│ 📍 Home · 12, Rajapeth…    Change    │
│ 💵 Cash on delivery                   │
│ [   ₹190 · Place order   ›        ]  │  ← CheckoutFooter (sticky)
└──────────────────────────────────────┘
```

### `CartLine.tsx`

```tsx
export const CartLine = memo(function CartLine({ line }: { line: QuoteLine }) {
  const setQty = useSetCartQuantity();
  const qty = useCartQuantity(line.variant_id);        // optimistic value
  const out = line.flags.includes('out_of_stock');

  return (
    <View className={cn('flex-row gap-3 py-3', out && 'opacity-50')} accessible accessibilityLabel={a11yLine(line)}>
      <CatalogImage path={line.image_path} size={56} />
      <View className="flex-1">
        <View className="flex-row items-center gap-1">
          {line.is_veg != null && <VegMark veg={line.is_veg} />}
          <Text numberOfLines={2}>{localize(line.name)}</Text>
        </View>
        <Text tone="muted">{localize(line.variant_label)}</Text>
        <LineBadges line={line} />
      </View>
      <View className="items-end gap-1">
        {out
          ? <Button size="sm" variant="ghost" onPress={() => setQty(line.variant_id, 0)}>{t('cart.remove')}</Button>
          : <Stepper value={qty} max={Math.min(line.max_per_order, line.stock_left ?? 50)}
                     onChange={(n) => setQty(line.variant_id, n)} />}
        <PriceTag price={line.price * (out ? 1 : line.billable_quantity)} mrp={line.mrp * (out ? 1 : line.billable_quantity)} />
      </View>
    </View>
  );
});

function LineBadges({ line }: { line: QuoteLine }) {
  return (
    <>
      {line.flags.includes('price_changed') && (
        <Badge tone={line.price > (line.price_at_add ?? 0) ? 'warning' : 'success'}>
          {t('cart.flag.priceChanged', { old: formatINR(line.price_at_add!), new: formatINR(line.price) })}
        </Badge>
      )}
      {line.flags.includes('low_stock') && <Badge tone="warning">{t('cart.flag.lowStock', { n: line.billable_quantity })}</Badge>}
      {line.flags.includes('over_limit') && <Badge tone="warning">{t('cart.flag.overLimit', { n: line.max_per_order })}</Badge>}
      {line.flags.includes('out_of_stock') && <Badge tone="danger">{t('cart.flag.outOfStock')}</Badge>}
      {!line.flags.length && line.stock_left != null && <Badge tone="muted">{t('cart.onlyNLeft', { n: line.stock_left })}</Badge>}
    </>
  );
}
```

### `QuoteBanners.tsx`

- `CART_NEEDS_REVIEW` → amber banner + **Update cart** button → `supabase.rpc('fix_cart')` (logged in) or a local equivalent for guests (`set(variant, billable_quantity)` for each flagged line) → invalidate.
- Any `price_changed` flag without other problems → blue info banner "Some prices changed" + **OK** → `fix_cart` (which also accepts current prices).
- Other blockers are shown by the footer button text (4.5), not as stacked banners, to avoid clutter. Only the **first** blocker is shown, in this priority: `CART_EMPTY` > `STORE_CLOSED` > `ACCOUNT_BLOCKED` > `NOT_SERVICEABLE` > `ADDRESS_REQUIRED` > `CART_NEEDS_REVIEW` > `BELOW_MIN_ORDER` > `COD_*` > `TOO_MANY_OPEN_ORDERS`.

### `BillDetails.tsx`

| Row | Value | When shown |
|---|---|---|
| Item total | ~~`mrp_total`~~ `item_total` | always |
| Delivery fee | `delivery_fee`, or ~~₹25~~ **FREE** when `delivery_fee_waived > 0` | always |
| Small cart fee ⓘ | `small_cart_fee` | when > 0; ⓘ explains "Added on orders below ₹{{small_cart_threshold}}" |
| Packaging fee | `packaging_fee` | when > 0 |
| **Grand total** | `grand_total` | always, bold |

`SavingsStrip`: "You save ₹{{savings}} on this order" when `savings > 0`.
`FreeDeliveryProgress`: a bar from 0 → `free_delivery_above`, text "Add ₹{{add_for_free_delivery}} more for FREE delivery", hidden when null; plus a small "Add more items" link to Home's bestsellers rail.

While a quote is refetching (`isFetching`), the bill shows a subtle shimmer over the numbers and the Place-order button is disabled for that moment, so nobody orders on a stale total.

### `CartBar.tsx` (floating)

Shown on all browsing screens when the cart has items. Count and total come from the **quote** (`item_count`, `item_total`); while the first quote loads, show the count from `useCartItems()` and "…" for the amount. It slides up with Reanimated and respects "Reduce motion".

**Checks**
- Remove the last item → the cart shows an empty state ("Your cart is empty" + "Start shopping").
- Large text at 200% → bill rows wrap, nothing is cut off.
- TalkBack reads each line as "Amul Taaza Milk, 500 ml, quantity 1, ₹27, price changed from ₹26".

**Tests**
- `BillDetails` renders FREE delivery with a strike-through when waived; hides zero rows.
- `LineBadges` shows exactly the right badge per flag.
- Snapshot of `CartLine` in each state (normal / low / out / price up / price down).

---

## 4.5 Checkout: address, COD, note

**Goal:** everything needed to place the order sits on the cart page, with sensible defaults, so a regular customer orders with **one tap**.

**Files**

```
mobile/src/features/checkout/
  useCheckout.ts            # Zustand: addressId, note (persisted per user)
  AddressRow.tsx
  PaymentSection.tsx
  NoteSection.tsx
mobile/app/checkout/address.tsx    # address chooser sheet/screen
```

### Address

- `useCheckout.addressId` defaults to the user's **default** address, or to the address selected in the Home header (Phase 3.4) if it's a saved address.
- `checkout/address.tsx` lists saved addresses (non-serviceable ones disabled with "Not deliverable") and "+ Add new address" (Phase 3.5 flow, returns here with the new id).
- Guests see "Log in to continue" instead of the address row (`LOGIN_REQUIRED` blocker); tapping it calls `requireLogin('checkout', '/cart')`.

### Payment

```
💵 Cash on delivery                    ●   (only option, selected)
📱 UPI / Online payment   Coming soon  ○   (disabled until Phase 10)
```

Under COD show one helpful line: "Pay ₹190 in cash or UPI to the person delivering." (Many Indian customers pay COD orders by scanning the shop's QR at the door; this is still "COD" for the app.)

### Note for the store

Quick chips that append to the note, plus free text (max 300 chars, counter shown):

| Chip key | en | mr | hi |
|---|---|---|---|
| `note.change500` | Need change for ₹500 | ₹५०० चे सुट्टे हवेत | ₹500 के छुट्टे चाहिए |
| `note.callFirst` | Call before delivery | डिलिव्हरीपूर्वी फोन करा | डिलीवरी से पहले फ़ोन करें |
| `note.noBell` | Don't ring the bell | बेल वाजवू नका | घंटी न बजाएँ |
| `note.leaveAtDoor` | Leave at the door | दारात ठेवा | दरवाज़े पर रख दें |

### Footer button states (`CheckoutFooter.tsx`)

| Quote state | Button |
|---|---|
| `can_checkout` | **₹190 · Place order ›** (primary) |
| first blocker `LOGIN_REQUIRED` | **Log in to continue** → login gate |
| `ADDRESS_REQUIRED` / `ADDRESS_NOT_FOUND` | **Select address** → `checkout/address` |
| `NOT_SERVICEABLE` | **Change address** (with the message above) |
| `CART_NEEDS_REVIEW` | **Update cart** → `fix_cart` |
| `BELOW_MIN_ORDER` | disabled · "Add ₹{{amount_needed}} more to order" |
| `STORE_CLOSED` | disabled · "Opens at {{time}}" or the busy message |
| others | disabled · message from the error table (4.8) |

**Checks**
- A returning user with a default address sees an enabled Place-order button without touching anything else.
- Changing the address re-quotes (the delivery check and ETA can change).

**Tests**
- `CheckoutFooter` renders the right label for each blocker (table-driven test).
- `useCheckout` resets `addressId` if the chosen address is deleted (`ADDRESS_NOT_FOUND`).

---

## 4.6 `place_order` (locks, idempotency, limits)

**Goal:** one transaction that re-checks everything, takes the stock, and writes the order, or changes nothing at all.

**SQL**

```sql
-- ---------------------------------------------------------------------------
-- Small summary returned to the app (and on idempotent replays)
-- ---------------------------------------------------------------------------

create or replace function private.order_summary(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id',       o.id,
    'order_number',   o.order_number,
    'status',         o.status,
    'payment_method', o.payment_method,
    'grand_total',    o.grand_total,
    'item_count',     (select coalesce(sum(oi.quantity), 0) from public.order_items oi where oi.order_id = o.id),
    'eta_minutes',    s.eta_minutes,
    'placed_at',      o.placed_at
  )
  from public.orders o
  join public.stores s on s.id = o.store_id
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- place_order
-- Errors are raised with message = a code from section 4.8 and, where useful,
-- detail = the fresh quote as JSON text (the app shows it without a refetch).
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_address_id      uuid,
  p_payment_method  public.payment_method,
  p_customer_note   text,
  p_idempotency_key uuid,
  p_expected_total  numeric default null     -- the grand total the user saw; mismatch → PRICE_CHANGED
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_existing   uuid;
  v_recent     int;
  v_addr       public.addresses%rowtype;
  v_service    jsonb;
  v_store_id   bigint;
  v_items      jsonb;
  v_quote      jsonb;
  v_order_id   uuid;
  v_line_count int;
  v_updated    int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  if p_customer_note is not null and char_length(p_customer_note) > 300 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
  end if;

  -- 1. One checkout at a time per user (covers double-taps and two devices).
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || v_uid::text, 0));

  -- 2. Idempotent replay: same key → same order, no new work.
  select o.id into v_existing
  from public.orders o
  where o.user_id = v_uid and o.idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return private.order_summary(v_existing) || jsonb_build_object('replayed', true);
  end if;

  -- 3. Rate limit: max 5 orders per 10 minutes per user.
  select count(*) into v_recent
  from public.orders o
  where o.user_id = v_uid and o.placed_at > now() - interval '10 minutes';

  if v_recent >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  -- 4. Resolve the store from the address (the quote re-checks and reports errors).
  select * into v_addr
  from public.addresses a
  where a.id = p_address_id and a.user_id = v_uid and a.deleted_at is null;

  if found then
    v_service := private.serviceability_for_point(v_addr.location);
    v_store_id := (v_service ->> 'store_id')::bigint;
  end if;

  -- 5. Lock the stock rows for everything in the cart, in a fixed order
  --    (variant_id) so two orders never deadlock on each other.
  if v_store_id is not null then
    perform 1
    from public.inventory i
    where i.store_id = v_store_id
      and i.variant_id in (select c.variant_id from public.cart_items c where c.user_id = v_uid)
    order by i.variant_id
    for update;
  end if;

  -- 6. Quote with the locks held: stock and prices can't change under us now.
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', c.variant_id, 'quantity', c.quantity, 'price_at_add', c.price_at_add)), '[]'::jsonb)
    into v_items
  from public.cart_items c
  where c.user_id = v_uid;

  v_quote := private._quote(v_items, v_uid, p_address_id, p_payment_method);

  if not (v_quote ->> 'can_checkout')::boolean then
    raise exception '%', v_quote -> 'blockers' -> 0 ->> 'code'
      using errcode = 'P0001', detail = v_quote::text;
  end if;

  if p_expected_total is not null and (v_quote ->> 'grand_total')::numeric <> p_expected_total then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001', detail = v_quote::text;
  end if;

  -- 7. Write the order.
  insert into public.orders (
    order_number, user_id, store_id, address_id, address_snapshot,
    status, payment_method, payment_status,
    item_total, mrp_total, delivery_fee, small_cart_fee, packaging_fee, grand_total,
    customer_note, idempotency_key, placed_at
  ) values (
    private.next_order_number(), v_uid, v_store_id, v_addr.id, private.address_snapshot(v_addr),
    'placed', p_payment_method, 'pending',
    (v_quote ->> 'item_total')::numeric,
    (v_quote ->> 'mrp_total')::numeric,
    (v_quote ->> 'delivery_fee')::numeric,
    (v_quote ->> 'small_cart_fee')::numeric,
    (v_quote ->> 'packaging_fee')::numeric,
    (v_quote ->> 'grand_total')::numeric,
    nullif(btrim(p_customer_note), ''), p_idempotency_key, now()
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, variant_id, product_id, name_snapshot, variant_label_snapshot, image_path,
    mrp, price, gst_rate, hsn_code, quantity, line_total
  )
  select v_order_id, v.id, p.id, p.name, v.label, l ->> 'image_path',
         v.mrp, v.price, coalesce(p.gst_rate, 0), p.hsn_code,
         (l ->> 'billable_quantity')::int,
         v.price * (l ->> 'billable_quantity')::int
  from jsonb_array_elements(v_quote -> 'lines') l
  join public.product_variants v on v.id = (l ->> 'variant_id')::bigint
  join public.products p on p.id = v.product_id
  where (l ->> 'billable_quantity')::int > 0;

  get diagnostics v_line_count = row_count;

  -- 8. Take the stock. The check constraint (stock >= 0) is the last line of defence.
  update public.inventory i
     set stock = i.stock - oi.quantity,
         updated_at = now()
    from public.order_items oi
   where oi.order_id = v_order_id
     and i.store_id = v_store_id
     and i.variant_id = oi.variant_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_line_count then
    raise exception 'STOCK_CHANGED' using errcode = 'P0001';     -- a variant had no inventory row
  end if;

  insert into public.inventory_movements (store_id, variant_id, delta, reason, order_id, actor_id)
  select v_store_id, oi.variant_id, -oi.quantity, 'order', v_order_id, v_uid
  from public.order_items oi
  where oi.order_id = v_order_id;

  insert into public.order_status_events (order_id, status, actor_id)
  values (v_order_id, 'placed', v_uid);

  -- 9. Empty the cart.
  delete from public.cart_items c where c.user_id = v_uid;

  return private.order_summary(v_order_id) || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.place_order(uuid, public.payment_method, text, uuid, numeric) from public, anon;
grant execute on function public.place_order(uuid, public.payment_method, text, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Replaces the Phase 3 version: keep orders (tax records), remove the person.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.orders o
    where o.user_id = v_uid and o.status not in ('delivered', 'cancelled')
  ) then
    raise exception 'ACTIVE_ORDERS_EXIST' using errcode = 'P0001';
  end if;

  update public.orders o
     set address_snapshot = (o.address_snapshot - 'receiver_name' - 'receiver_phone' - 'house'
                             - 'landmark' - 'latitude' - 'longitude')
                            || jsonb_build_object('receiver_name', 'Deleted user'),
         customer_note = null
   where o.user_id = v_uid;

  delete from public.cart_items where user_id = v_uid;
  delete from public.addresses  where user_id = v_uid;   -- orders.address_id → null

  delete from auth.users where id = v_uid;                -- profiles cascade; orders.user_id → null
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
```

### How the concurrency works

```
Customer A (last unit)                         Customer B (same unit)
──────────────────────                         ──────────────────────
advisory lock (A)                              advisory lock (B)   ← different users, no wait
SELECT inventory … FOR UPDATE  → gets row      SELECT inventory … FOR UPDATE → WAITS
_quote: stock 1, ok
INSERT order, stock 1 → 0, COMMIT  ──────────► lock granted; next statement sees stock 0
                                               _quote: out_of_stock → CART_NEEDS_REVIEW
                                               RAISE → rollback, nothing written
```

- The **advisory lock** serialises one user's checkouts (double-tap, two devices). The second call waits, then finds the order by idempotency key and returns it.
- The **row locks**, always taken in `variant_id` order, serialise different users buying the same items without deadlocks.
- In `READ COMMITTED` (Postgres default), each statement after the lock sees the newest committed stock, so the quote inside the transaction is current.
- Other customers' screens see the stock drop immediately through the Phase 1 `inventory` Realtime channel.

### App: `usePlaceOrder.ts`

```ts
import * as Crypto from 'expo-crypto';

const PENDING_KEY = 'nk.checkout.pendingKey';

export function usePlaceOrder() {
  const qc = useQueryClient();
  const router = useRouter();
  // One key per checkout attempt. It survives retries and app restarts until
  // an order is confirmed, so a retry can never create a second order.
  const keyRef = useRef<string>(storage.getString(PENDING_KEY) ?? newKey());

  function newKey() {
    const k = Crypto.randomUUID();
    storage.set(PENDING_KEY, k);
    return k;
  }

  return useMutation({
    mutationKey: ['place-order'],
    mutationFn: async (input: { addressId: string; note: string; expectedTotal: number }) => {
      const { data, error } = await supabase.rpc('place_order', {
        p_address_id: input.addressId,
        p_payment_method: 'cod',
        p_customer_note: input.note || null,
        p_idempotency_key: keyRef.current,
        p_expected_total: input.expectedTotal,
      });
      if (error) throw toCheckoutError(error);
      return data as unknown as PlacedOrder;
    },
    retry: (count, err: CheckoutError) => err.code === 'NETWORK' && count < 3,   // safe: same key
    retryDelay: (n) => 1000 * 2 ** n,
    onSuccess: (order) => {
      keyRef.current = newKey();                       // next checkout is a new attempt
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ['cart'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      router.replace({ pathname: '/order/placed', params: { id: order.order_id } });
    },
    onError: (err: CheckoutError) => {
      const uid = useAuth.getState().session?.user.id;
      if (err.quote) qc.setQueryData(['cart', 'quote', uid, err.quote.address_id], err.quote);
      else qc.invalidateQueries({ queryKey: ['cart'] });
      showCheckoutError(err);                          // 4.8
    },
  });
}

export function toCheckoutError(e: PostgrestError | Error): CheckoutError {
  if (!('code' in e) || e.message === 'Network request failed' || e.message?.includes('fetch')) {
    return { code: 'NETWORK' };
  }
  const code = (KNOWN_CODES as readonly string[]).includes(e.message) ? (e.message as CheckoutCode) : 'UNKNOWN';
  let quote: CartQuote | undefined;
  try { quote = e.details ? JSON.parse(e.details) : undefined; } catch { /* not JSON */ }
  return { code, quote };
}
```

**Double-tap guard (three layers):**
1. The button is disabled while `mutation.isPending` **and** while the quote is refetching.
2. The same idempotency key is reused for retries, so even if two requests leave the phone, the database returns one order.
3. The advisory lock makes the second request wait for the first and then replay it.

**App killed during "Placing order…":** on the next cart open, if `nk.checkout.pendingKey` exists, run `supabase.from('orders').select('id, order_number').eq('idempotency_key', key).maybeSingle()`. If an order exists, show "Your order NK-261016-0042 was placed ✓" with a "Track" button and rotate the key; the cart is already empty on the server.

**Checks**
- Place an order → `orders`, `order_items`, `inventory_movements` (negative deltas), one `order_status_events` row `placed`, stock reduced, `cart_items` empty.
- Airplane mode right after tapping → turn it off → retry → same order number, one order in the table.
- Raise a price in Studio after the cart loaded, then tap Place order → `PRICE_CHANGED` banner showing the new total; tapping again places it at the new total.

**Tests:** pgTAP below; plus the race script.

---

## 4.7 Order placed screen

**Goal:** a moment of confidence ("it worked") and a clear next step, with no way to accidentally go "back" into checkout.

**File:** `mobile/app/order/placed.tsx`

```
┌──────────────────────────────────────┐
│                                      │
│              ✅ (animated)            │
│         Order placed!                │
│      NK-261016-0042                  │
│                                      │
│   Arriving in about 20 minutes       │
│   4 items · ₹190 · Cash on delivery  │
│   Keep ₹190 ready                    │
│                                      │
│   [      Track order      ]          │  → /order/[id] (Phase 5)
│   [  Continue shopping    ]          │  → /
│   📞 Call store                       │
└──────────────────────────────────────┘
```

- Reached with `router.replace`, and the screen sets `gestureEnabled: false` and handles Android back by going to Home.
- Data comes from the mutation result (instant), then `supabase.from('orders').select(...)` for the full row.
- The checkmark uses a small Reanimated scale + fade (no Lottie dependency); with "Reduce motion" it's static.
- Until Phase 5 ships, **Track order** opens a simple order screen showing the status from the row; Phase 5 makes it live.
- Ask for push-notification permission **here** (Phase 5.8), the moment it's obviously useful: "Get updates when your order is packed and on its way?"

| Key | en | mr | hi |
|---|---|---|---|
| `placed.title` | Order placed! | ऑर्डर झाली! | ऑर्डर हो गया! |
| `placed.eta` | Arriving in about {{min}} minutes | सुमारे {{min}} मिनिटांत पोहोचेल | लगभग {{min}} मिनट में पहुँचेगा |
| `placed.keepCash` | Keep ₹{{amount}} ready | ₹{{amount}} तयार ठेवा | ₹{{amount}} तैयार रखें |
| `placed.track` | Track order | ऑर्डर पाहा | ऑर्डर देखें |
| `placed.continue` | Continue shopping | खरेदी सुरू ठेवा | ख़रीदारी जारी रखें |

---

## 4.8 Edge cases & error copy

**Goal:** every failure says what happened and what to do, in the user's language, and the app recovers without losing the cart.

### Failure codes (from `get_cart_quote` blockers, `place_order`, and cart RPCs)

| Code | Source | en | mr | hi | Recovery |
|---|---|---|---|---|---|
| `NOT_AUTHENTICATED` / `LOGIN_REQUIRED` | all | Please log in to place your order. | ऑर्डर करण्यासाठी लॉग इन करा. | ऑर्डर करने के लिए लॉग इन करें। | Login gate → back to cart |
| `CART_EMPTY` | quote | Your cart is empty. | तुमची कार्ट रिकामी आहे. | आपका कार्ट खाली है। | "Start shopping" |
| `CART_NEEDS_REVIEW` | quote, place | Some items changed. Please review your cart. | काही वस्तूंमध्ये बदल झाला आहे. कृपया कार्ट तपासा. | कुछ सामान बदल गए हैं। कृपया कार्ट देखें। | "Update cart" → `fix_cart` |
| `ADDRESS_REQUIRED` | quote | Choose a delivery address. | डिलिव्हरीचा पत्ता निवडा. | डिलीवरी का पता चुनें। | Address chooser |
| `ADDRESS_NOT_FOUND` | quote, place | This address was removed. Please choose another. | हा पत्ता काढून टाकला आहे. दुसरा निवडा. | यह पता हटा दिया गया है। दूसरा चुनें। | Clear `addressId`, chooser |
| `NOT_SERVICEABLE` | quote, place | We don't deliver to this address yet. | या पत्त्यावर आम्ही अजून डिलिव्हरी करत नाही. | इस पते पर हम अभी डिलीवरी नहीं करते। | "Change address" |
| `STORE_CLOSED` | quote, place | Store is closed now. Opens at {{time}}. | दुकान सध्या बंद आहे. {{time}} ला उघडेल. | दुकान अभी बंद है। {{time}} बजे खुलेगा। | Keep cart; button re-enables live when it opens |
| `BELOW_MIN_ORDER` | quote, place | Add items worth ₹{{amount}} more to place the order. | ऑर्डर करण्यासाठी आणखी ₹{{amount}} च्या वस्तू जोडा. | ऑर्डर करने के लिए ₹{{amount}} का और सामान जोड़ें। | "Add more items" |
| `COD_NOT_ALLOWED` | quote, place | Cash on delivery isn't available for your account. Please call the store. | तुमच्या खात्यासाठी कॅश ऑन डिलिव्हरी उपलब्ध नाही. कृपया दुकानाला फोन करा. | आपके खाते के लिए कैश ऑन डिलीवरी उपलब्ध नहीं है। कृपया दुकान को फ़ोन करें। | "Call store" |
| `COD_LIMIT_EXCEEDED` | quote, place | Cash orders can be up to ₹{{max}}. Please remove some items. | कॅश ऑर्डर जास्तीत जास्त ₹{{max}} पर्यंत असू शकते. काही वस्तू काढा. | कैश ऑर्डर अधिकतम ₹{{max}} तक हो सकता है। कुछ सामान हटाएँ। | Edit cart |
| `ACCOUNT_BLOCKED` | quote, place | Your account can't place orders right now. Please contact the store. | तुमच्या खात्यातून सध्या ऑर्डर करता येत नाही. कृपया दुकानाशी संपर्क करा. | आपके खाते से अभी ऑर्डर नहीं हो सकता। कृपया दुकान से संपर्क करें। | "Call store" |
| `TOO_MANY_OPEN_ORDERS` | quote, place | You already have orders on the way. Please wait for one to be delivered. | तुमच्या ऑर्डर आधीच सुरू आहेत. एक ऑर्डर पोहोचेपर्यंत थांबा. | आपके ऑर्डर पहले से रास्ते में हैं। एक ऑर्डर पहुँचने तक रुकें। | Link to Orders |
| `RATE_LIMITED` | place | Too many orders in a short time. Please try again in a few minutes. | थोड्या वेळात खूप ऑर्डर झाल्या. काही मिनिटांनी पुन्हा प्रयत्न करा. | कम समय में बहुत ज़्यादा ऑर्डर। कुछ मिनट बाद फिर कोशिश करें। | Wait |
| `PRICE_CHANGED` | place | Prices changed. Your new total is ₹{{total}}. | किंमती बदलल्या आहेत. नवीन एकूण रक्कम ₹{{total}} आहे. | कीमतें बदल गई हैं। नया कुल ₹{{total}} है। | Quote from `details` shown; tap again to confirm |
| `PAYMENT_METHOD_UNAVAILABLE` | quote, place | Online payment is coming soon. Please use Cash on Delivery. | ऑनलाइन पेमेंट लवकरच येत आहे. कृपया कॅश ऑन डिलिव्हरी निवडा. | ऑनलाइन भुगतान जल्द आ रहा है। कृपया कैश ऑन डिलीवरी चुनें। | Switch to COD |
| `STOCK_CHANGED` | place | Stock changed while ordering. Please try again. | ऑर्डर करताना स्टॉक बदलला. कृपया पुन्हा प्रयत्न करा. | ऑर्डर करते समय स्टॉक बदल गया। कृपया फिर से कोशिश करें। | Re-quote |
| `OUT_OF_STOCK` | set_cart_quantity | This item just went out of stock. | ही वस्तू आत्ताच संपली. | यह सामान अभी-अभी ख़त्म हो गया। | "Notify me" (Phase 2) |
| `VARIANT_NOT_FOUND` | set_cart_quantity | This item is no longer available. | ही वस्तू आता उपलब्ध नाही. | यह सामान अब उपलब्ध नहीं है। | Remove line |
| `CART_TOO_LARGE` | merge, guest quote | Your cart has too many different items. | तुमच्या कार्टमध्ये खूप वेगवेगळ्या वस्तू आहेत. | आपके कार्ट में बहुत अलग-अलग सामान हैं। | Remove some |
| `NOTE_TOO_LONG` | place | The note can be up to 300 characters. | टीप जास्तीत जास्त ३०० अक्षरांची असू शकते. | नोट अधिकतम 300 अक्षरों का हो सकता है। | Shorten |
| `IDEMPOTENCY_KEY_REQUIRED` | place | Something went wrong. Please try again. | काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा. | कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें। | App bug: log to Sentry |
| `NETWORK` | client | Couldn't confirm your order. Tap Retry. It won't create a duplicate order. | ऑर्डरची खात्री होऊ शकली नाही. पुन्हा प्रयत्न करा दाबा. दुसरी ऑर्डर तयार होणार नाही. | ऑर्डर की पुष्टि नहीं हो पाई। फिर से कोशिश करें दबाएँ। दोबारा ऑर्डर नहीं बनेगा। | Retry with the same key |
| `UNKNOWN` | client | Something went wrong. Please try again. | काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा. | कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें। | Retry; Sentry |

Line-flag copy:

| Key | en | mr | hi |
|---|---|---|---|
| `cart.flag.priceChanged` | Price changed {{old}} → {{new}} | किंमत बदलली {{old}} → {{new}} | कीमत बदली {{old}} → {{new}} |
| `cart.flag.lowStock` | Only {{n}} left | फक्त {{n}} शिल्लक | सिर्फ़ {{n}} बचे हैं |
| `cart.flag.overLimit` | Max {{n}} per order | एका ऑर्डरमध्ये जास्तीत जास्त {{n}} | एक ऑर्डर में अधिकतम {{n}} |
| `cart.flag.outOfStock` | Out of stock | स्टॉक संपला | स्टॉक में नहीं |
| `cart.freeDelivery` | Add ₹{{amount}} more for FREE delivery | मोफत डिलिव्हरीसाठी आणखी ₹{{amount}} च्या वस्तू जोडा | मुफ़्त डिलीवरी के लिए ₹{{amount}} का और सामान जोड़ें |
| `cart.youSave` | You save ₹{{amount}} on this order | या ऑर्डरवर तुमची ₹{{amount}} बचत | इस ऑर्डर पर आपकी ₹{{amount}} की बचत |
| `bill.itemTotal` | Item total | वस्तूंची एकूण किंमत | सामान का कुल |
| `bill.deliveryFee` | Delivery fee | डिलिव्हरी शुल्क | डिलीवरी शुल्क |
| `bill.smallCartFee` | Small cart fee | लहान ऑर्डर शुल्क | छोटे ऑर्डर का शुल्क |
| `bill.packagingFee` | Packaging fee | पॅकिंग शुल्क | पैकिंग शुल्क |
| `bill.grandTotal` | Grand total | एकूण रक्कम | कुल राशि |
| `pay.cod` | Cash on delivery | कॅश ऑन डिलिव्हरी (रोख) | कैश ऑन डिलीवरी (नकद) |

> All Marathi and Hindi copy needs a native-speaker review before release (Phase 9).

### Other edge cases

| Situation | Behaviour |
|---|---|
| Product deactivated while in the cart | Quote treats it as stock 0 → `out_of_stock`; "Update cart" removes it. |
| Variant deleted from the DB | `cart_items` cascades; the line disappears on the next quote. (Admins should deactivate, not delete; Phase 7.) |
| Price **dropped** | Green "Price dropped" badge; not a blocker, but `PRICE_CHANGED` still fires if the total the user saw differs (they see the lower total and confirm). |
| Store closes during checkout | Realtime `store:<id>` → quote refetch → button becomes "Opens at …"; if the request was already in flight, `place_order` raises `STORE_CLOSED`. |
| Address edited on another device | Quote uses the current address; the order stores the snapshot at the moment of placing. |
| Session expired mid-checkout | supabase-js refreshes automatically; if the refresh fails, `NOT_AUTHENTICATED` → login gate → back to cart, key unchanged. |
| Order placed at 23:59:59 IST | The order number uses the IST date at the moment of insert; the counter for the new day starts at 0001. |
| Same user, two phones, both tap Place | Advisory lock: the second waits, then gets `CART_EMPTY` (the cart was cleared by the first). Its UI shows "Your order NK-… was placed" by checking open orders when it sees `CART_EMPTY` right after a place attempt. |
| Guest cart with a variant that no longer exists | `quote_guest_cart` drops unknown ids; the guest store removes them after the quote (ids not present in `lines`). |
| Very slow network | Button shows "Placing order…" with a spinner after 300 ms, and "Still working, don't close the app" after 8 s. |

---

## Testing for Phase 4

### pgTAP: `supabase/tests/0400_cart_orders.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create or replace function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'a4@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'b4@test.local');

-- Seed store: always open, 4 km radius, simple fees.
-- (opening_hours format from Phase 1: per weekday [{open, close}] in IST.)
update public.stores set
  location = extensions.st_setsrid(extensions.st_makepoint(77.75, 20.93), 4326)::extensions.geography,
  service_radius_km = 4, service_area = null,
  is_accepting_orders = true,
  opening_hours = '{"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],
                    "wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],
                    "fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}],
                    "sun":[{"open":"00:00","close":"23:59"}]}'::jsonb,
  min_order_value = 50, delivery_fee = 20, free_delivery_above = 199,
  small_cart_threshold = 99, small_cart_fee = 10, packaging_fee = 0,
  max_cod_order_value = 2000, max_open_orders_per_user = 3
where id = (select min(id) from public.stores);

-- A product with one variant (₹60, MRP ₹70), stock 1.
with c as (
  insert into public.categories (slug, name) values ('t-dairy', '{"en":"T Dairy"}') returning id
), p as (
  insert into public.products (category_id, slug, name, gst_rate, is_active)
  select id, 't-milk', '{"en":"T Milk"}', 5, true from c returning id
), v as (
  insert into public.product_variants (product_id, sku, label, net_quantity, unit, mrp, price, max_per_order, is_active)
  select id, 'T-MILK-1', '{"en":"1 l"}', 1, 'l', 70, 60, 5, true from p returning id
)
insert into public.inventory (store_id, variant_id, stock, is_available)
select (select min(id) from public.stores), id, 1, true from v;

create temp table t_ids as
select (select id from public.product_variants where sku = 'T-MILK-1') as variant_id,
       (select min(id) from public.stores) as store_id;
grant select on t_ids to authenticated;

-- Addresses at the store location.
insert into public.addresses (user_id, receiver_name, receiver_phone, house, area, city, pincode, latitude, longitude)
values ('00000000-0000-0000-0000-0000000000a4', 'A', '9876543210', '1', 'Area', 'City', '444601', 20.93, 77.75),
       ('00000000-0000-0000-0000-0000000000b4', 'B', '9876543211', '2', 'Area', 'City', '444601', 20.93, 77.75);

create temp table t_addr as
select user_id, id from public.addresses where user_id in
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b4');
grant select on t_addr to authenticated;

-- ---------------------------------------------------------------- as A
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');

-- 1. empty cart
select is(public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) -> 'blockers' -> 0 ->> 'code',
          'CART_EMPTY', 'empty cart is blocked');

-- 2. clamp to stock
select is((public.set_cart_quantity((select variant_id from t_ids), 4) ->> 'quantity')::int, 1, 'quantity clamped to stock');

-- 3–5. fees: ₹60 < 99 → small cart fee 10; < 199 → delivery 20; total 90
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'small_cart_fee')::numeric, 10::numeric, 'small cart fee');
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'grand_total')::numeric, 90::numeric, 'grand total = 60 + 20 + 10');
select is((public.get_cart_quote((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4')) ->> 'add_for_free_delivery')::numeric, 139::numeric, 'free delivery hint');

-- 6. min order: raise min to 100 → BELOW_MIN_ORDER
reset role; select pg_temp.as_postgres();
update public.stores set min_order_value = 100 where id = (select store_id from t_ids);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'BELOW_MIN_ORDER', 'below minimum order is rejected');
reset role; select pg_temp.as_postgres();
update public.stores set min_order_value = 50 where id = (select store_id from t_ids);

-- 7. closed store → STORE_CLOSED
update public.stores set is_accepting_orders = false where id = (select store_id from t_ids);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'STORE_CLOSED', 'closed store is rejected');
reset role; select pg_temp.as_postgres();
update public.stores set is_accepting_orders = true where id = (select store_id from t_ids);

-- 8. price changed → PRICE_CHANGED when expected total differs
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', null, gen_random_uuid(), 85) $$,
  'P0001', 'PRICE_CHANGED', 'expected total mismatch is rejected');

-- 9–12. success + idempotent replay
create temp table t_key as select gen_random_uuid() as k;
select is(
  (public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', 'Call first', (select k from t_key), 90) ->> 'replayed')::boolean,
  false, 'order placed');
select is(
  (public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000a4'), 'cod', 'Call first', (select k from t_key), 90) ->> 'replayed')::boolean,
  true, 'same key replays');
select is((select count(*)::int from public.orders), 1, 'exactly one order for A');
select is((select count(*)::int from public.cart_items), 0, 'cart cleared');
select matches((select order_number from public.orders limit 1), '^NK-[0-9]{6}-[0-9]{4,}$', 'order number format');

-- 13. stock taken and logged
reset role; select pg_temp.as_postgres();
select is((select stock from public.inventory where variant_id = (select variant_id from t_ids)), 0, 'stock decremented to 0');
select is((select delta from public.inventory_movements where variant_id = (select variant_id from t_ids) and reason = 'order'), -1, 'movement logged');

-- 14–15. B wanted the same last unit: the cart now needs review
insert into public.cart_items (user_id, variant_id, quantity, price_at_add)
values ('00000000-0000-0000-0000-0000000000b4', (select variant_id from t_ids), 1, 60);
set local role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select throws_ok(
  $$ select public.place_order((select id from t_addr where user_id = '00000000-0000-0000-0000-0000000000b4'), 'cod', null, gen_random_uuid()) $$,
  'P0001', 'CART_NEEDS_REVIEW', 'second buyer of the last unit is rejected');

-- 16. RLS: B can't see A's order
select is((select count(*)::int from public.orders), 0, 'B sees no orders of A');

-- 17. No direct writes
select throws_ok(
  $$ insert into public.orders (order_number, store_id, address_snapshot, item_total, mrp_total, grand_total, idempotency_key)
     values ('X', 1, '{}', 0, 0, 0, gen_random_uuid()) $$,
  '42501', null, 'customers cannot insert orders directly');

select * from finish();
rollback;
```

> Adjust the fixture inserts to any extra `not null` columns Phase 1 added to `categories`, `products` or `product_variants`.

### Race test (real concurrency): `supabase/tests/race/place_order_race.ts`

pgTAP runs in one session, so true parallelism is tested with a small script against the **local** stack (`supabase start`):

```ts
// npx tsx supabase/tests/race/place_order_race.ts
import { createClient } from '@supabase/supabase-js';
const URL = 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;     // local only, never in the app
const admin = createClient(URL, SERVICE);

const N = 20;
const VARIANT_ID = Number(process.env.VARIANT_ID);          // a seeded variant
await admin.from('inventory').update({ stock: 1, is_available: true }).eq('variant_id', VARIANT_ID);

const users = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const email = `race${i}@test.local`;
  await admin.auth.admin.createUser({ email, password: 'pass-123456', email_confirm: true });
  const c = createClient(URL, ANON);
  await c.auth.signInWithPassword({ email, password: 'pass-123456' });
  const { data: addr } = await c.from('addresses').insert({
    receiver_name: 'R', receiver_phone: '9876543210', house: '1', area: 'Area', city: 'City',
    pincode: '444601', latitude: 20.93, longitude: 77.75,
  }).select('id').single();
  await c.rpc('set_cart_quantity', { p_variant_id: VARIANT_ID, p_quantity: 1 });
  return { c, addressId: addr!.id };
}));

// Set stock back to 1 (set_cart_quantity didn't change it, but be explicit), then fire all at once.
await admin.from('inventory').update({ stock: 1 }).eq('variant_id', VARIANT_ID);
const results = await Promise.all(users.map(({ c, addressId }) =>
  c.rpc('place_order', { p_address_id: addressId, p_payment_method: 'cod', p_customer_note: null, p_idempotency_key: crypto.randomUUID() })));

const ok = results.filter((r) => !r.error).length;
const { data: inv } = await admin.from('inventory').select('stock').eq('variant_id', VARIANT_ID).single();
console.log({ ok, failed: N - ok, stock: inv!.stock, errors: [...new Set(results.map((r) => r.error?.message).filter(Boolean))] });
if (ok !== 1 || inv!.stock !== 0) process.exit(1);
```

Make sure the store's minimum order is below the variant's price for this run. Run it in CI after `supabase start` (Phase 0.11 workflow), and clean up the test users afterwards (or run it on a throwaway `supabase db reset`).

### App tests

| Type | What |
|---|---|
| Unit | `toCheckoutError` (code from `message`, quote from `details`, network detection); `guestCart`; blocker priority; `CheckoutFooter` label table |
| Component | `CartLine` states; `BillDetails` (free delivery strike-through, hidden zero rows); `QuoteBanners` |
| Maestro | `guest_cart_merge.yaml` (add as guest → login → quantities merged), `checkout_cod.yaml` (cart → place order → placed screen → back goes Home), `price_changed.yaml` (uses a dev-only script to bump the price mid-flow) |
| Manual | Airplane mode during place order; two phones racing for the last item; Marathi + large text on the cart |

---

## Phase 4 wrap-up

- **Shipped:** guest + server cart with merge and cross-device live sync, a server-side live quote with clear per-line problems, a Blinkit-style cart with bill details and free-delivery nudges, one-page checkout with COD and quick notes, a safe `place_order` (row locks, idempotency, rate and COD limits, snapshots, stock movements), the order-placed screen, and full error copy in three languages.
- **SQL:** `0400_cart_orders.sql`: `cart_items`, `orders`, `order_items`, `order_status_events`, `inventory_movements`, `private.order_counters`, `private.default_store_id`, `private.next_order_number`, `private.address_snapshot`, `private._quote`, `private.order_summary`, `private.broadcast_cart_change`, `set_cart_quantity`, `merge_guest_cart`, `fix_cart`, `get_cart_quote`, `quote_guest_cart`, `place_order`, updated `delete_my_account`; Realtime policy for `cart:<uid>`. Tests: `0400_cart_orders.test.sql` + the race script.
- **Next (Phase 5):** the customer's live order screen (Realtime on `orders`), cancel (restocking through `inventory_movements`), reorder, invoice, issue reports and notifications.
