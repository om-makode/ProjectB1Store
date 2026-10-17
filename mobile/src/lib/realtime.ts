import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { catalogKeys } from '@/features/catalog/hooks';
import { useLiveCatalog } from '@/features/catalog/live';

import { logger } from './logger';
import { uniqueTopic } from './realtimeTopic';
import { getSupabase } from './supabase';

type Row = Record<string, unknown>;
const num = (v: unknown, d = 0) =>
  typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : d;

/**
 * One shared Realtime channel for live stock & prices (plan §5: few channels, always a hint).
 * - inventory UPDATE → patch stock for that variant
 * - product_variants UPDATE → patch price/MRP/limit
 * On return to the foreground or a reconnect, live patches are dropped and catalog queries
 * refetch, which also covers any events missed while in the background.
 */
export function useCatalogRealtime(storeId: number | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return; // not configured (.env missing): the screens show the config error
    }
    const { patchInventory, patchVariant, reset } = useLiveCatalog.getState();
    const refresh = () => {
      reset();
      void qc.invalidateQueries({ queryKey: catalogKeys.all });
    };

    let subscribedOnce = false;
    const channel = supabase
      .channel(uniqueTopic('catalog-live'))
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inventory',
          ...(storeId ? { filter: `store_id=eq.${storeId}` } : {}),
        },
        (payload) => {
          const r = payload.new as Row;
          patchInventory(num(r.variant_id), {
            stock: num(r.stock),
            is_available: r.is_available !== false,
            low_stock_threshold: num(r.low_stock_threshold, 5),
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'product_variants' },
        (payload) => {
          const r = payload.new as Row;
          patchVariant(num(r.id), {
            price: num(r.price),
            mrp: num(r.mrp),
            max_per_order: num(r.max_per_order, 10),
            is_active: r.is_active !== false,
          });
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => {
        void qc.invalidateQueries({ queryKey: catalogKeys.store });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) refresh(); // reconnected: catch up on anything missed
          subscribedOnce = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.warn('realtime: catalog channel', status);
        }
      });

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });

    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [qc, storeId]);
}
