/**
 * Strategy difficulty rating — browser-safe utility.
 *
 * Kept separate from telegram.ts so it can be imported by client components
 * (ChartLayout) without pulling in the server-only pg / dns dependency chain.
 */

import type { ConditionGroup } from '@/types/strategy';

/**
 * Compute a 1–7 star difficulty rating from a strategy's entry condition groups.
 *
 * Accounts for group structure — more OR groups = more alternative entry paths =
 * easier to fire = fewer stars. Formula:
 *
 *   AND groups   → +1 flat each (required filters; OR-logic inside means only
 *                  1 condition must fire, so counting all conditions overstates
 *                  their contribution)
 *
 *   OR groups    → avg(conditions per OR group) — how hard each path is on average,
 *                  not the inflated total sum
 *
 *   OR penalty   → −0.5 per extra OR group beyond the first (each extra path
 *                  reduces selectivity)
 *
 *   Confirmation → +0.5 per extra confirmation candle across all active conditions
 *
 * Result clamped to [1, 7].
 */
export function strategyRating(entryGroups: ConditionGroup[]): number {
  // Work only with groups that have at least one active condition
  const active = entryGroups.filter((g) =>
    g.conditions.some((c) => c.enabled !== false),
  );
  if (active.length === 0) return 1;

  // Mirror the evaluator: index 0 is always treated as an OR group
  const orGroups  = active.filter((g, i) => i === 0 || (g.operator ?? 'or') === 'or');
  const andGroups = active.filter((g, i) => i  >  0 &&  g.operator          === 'and');

  // AND groups: flat +1 each (required filter, but OR-logic inside = just need 1 cond)
  const andScore = andGroups.length;

  // OR groups: average active-condition count across groups
  const orCondCounts = orGroups.map(
    (g) => g.conditions.filter((c) => c.enabled !== false).length,
  );
  const avgOrScore = orCondCounts.length > 0
    ? orCondCounts.reduce((a, b) => a + b, 0) / orCondCounts.length
    : 0;

  // Each extra OR group beyond the first opens another entry path → penalty
  const orPenalty = Math.max(0, orGroups.length - 1) * 0.5;

  // Confirmation bonus: +0.5 per extra candle on confirmation-mode conditions
  const confirmBonus = active
    .flatMap((g) => g.conditions.filter((c) => c.enabled !== false))
    .reduce((sum, c) => {
      if ((c.checkMode ?? 'confirmation') !== 'confirmation') return sum;
      return sum + Math.max(0, (c.checkCandles ?? 1) - 1) * 0.5;
    }, 0);

  const score = andScore + avgOrScore - orPenalty + confirmBonus;
  return Math.min(7, Math.max(1, Math.round(score)));
}
