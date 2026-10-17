alter type public.order_status   add value if not exists 'awaiting_payment' before 'placed';
alter type public.payment_status add value if not exists 'partially_refunded' after 'paid';

create type public.payment_attempt_status as enum ('created', 'authorized', 'captured', 'failed');
create type public.refund_status          as enum ('pending', 'processing', 'processed', 'failed');
