/**
 * Client-side helpers for strategy DB operations.
 *
 * All functions throw on failure — callers decide whether to surface the error
 * (blocking, user-visible) or fire-and-forget with a .catch() warn.
 *
 * Rule: never call these from Server Components — they hit /api/* routes.
 */

import type { Strategy } from '@/types/strategy';

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/** Upsert a single strategy into the DB (calls POST /api/strategies). */
export async function pushStrategyToDb(s: Strategy): Promise<void> {
  const res = await fetch('/api/strategies', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(s),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

/** Delete a single strategy from the DB by id. */
export async function deleteStrategyFromDb(id: string): Promise<void> {
  const res = await fetch(`/api/strategies?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Wipe every strategy from the DB (cascade-deletes versions). */
export async function deleteAllStrategiesFromDb(): Promise<void> {
  const res = await fetch('/api/strategies/all', { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Fetch all strategies from the DB. Returns an empty array if the DB is unreachable. */
export async function fetchStrategiesFromDb(): Promise<Strategy[] | null> {
  try {
    const res = await fetch('/api/strategies');
    if (!res.ok) return null;
    const data = await res.json() as { strategies: Strategy[] };
    return data.strategies;
  } catch {
    return null;
  }
}

/**
 * Fan-out upsert — push an array of strategies to the DB in parallel.
 * Returns the count of successful pushes; logs individual failures as warnings.
 */
export async function pushManyStrategiesToDb(list: Strategy[]): Promise<number> {
  const results = await Promise.allSettled(list.map(pushStrategyToDb));
  let ok = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
    } else {
      console.warn('[strategy/api] push failed:', r.reason);
    }
  }
  return ok;
}
