/**
 * supabase.channel(name) returns the EXISTING channel when one with that name is still open, and
 * adding `.on(...)` to an already-subscribed channel throws. Remounts (fast refresh, StrictMode,
 * a changed dependency) can run before the async removeChannel() of the old one finishes, so
 * postgres_changes channels (where the name is irrelevant) get a unique name per subscription.
 */
export const uniqueTopic = (base: string) => `${base}:${Math.random().toString(36).slice(2, 10)}`;
