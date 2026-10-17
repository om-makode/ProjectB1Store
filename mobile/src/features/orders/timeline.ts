import { TIMELINE, type OrderEvent, type OrderStatus } from './api';

export type Step = { status: OrderStatus; at: string | null; state: 'done' | 'current' | 'todo' };

/** Pure: which steps are done, which is current, and when each happened. */
export function timelineSteps(status: OrderStatus, events: OrderEvent[]): Step[] {
  const lastAt = (s: OrderStatus) =>
    events.filter((e) => e.status === s).at(-1)?.created_at ?? null;

  if (status === 'cancelled') {
    // Show the steps it actually reached, then the cancellation.
    const reached = TIMELINE.filter((s) => lastAt(s) !== null);
    return [
      ...reached.map((s) => ({ status: s, at: lastAt(s), state: 'done' as const })),
      { status: 'cancelled', at: lastAt('cancelled'), state: 'current' as const },
    ];
  }
  const idx = TIMELINE.indexOf(status); // -1 for awaiting_payment: nothing reached yet
  return TIMELINE.map((s, i) => ({
    status: s,
    at: lastAt(s),
    state: i < idx || (i === idx && s === 'delivered') ? 'done' : i === idx ? 'current' : 'todo',
  }));
}
