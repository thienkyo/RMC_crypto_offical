/**
 * Strategy rating utilities — browser-safe (no server deps).
 *
 * Two functions:
 *
 *   signalScore(firedGroups)
 *     Dynamic per-signal score computed from conditions that actually PASSED.
 *     Used by: Telegram message (fire-time), SignalHistory row, Portfolio row.
 *
 *   strategyScoreRange(entryGroups)
 *     Structural min/max range from the strategy definition.
 *     Used by: ChartLayout signal popover (no fire data available).
 *
 *   strategyRating(entryGroups)  ← backward-compat shim
 *     Returns the midpoint of strategyScoreRange. Still used by telegram.ts
 *     re-export and any code not yet migrated.
 */

import type { ConditionGroup }         from '@/types/strategy';
import type { ConditionSnapshotGroup }  from '@/lib/strategy/signalMetrics';

// ─── Fire-time score ──────────────────────────────────────────────────────────

/**
 * Extended snapshot item that may carry checkCandles (added in the new schema).
 * Old snapshots lack it — accessing returns undefined, which safely defaults to 1.
 */
interface SnapshotItemWithCheck {
  passed:        boolean;
  checkCandles?: number;
}

/**
 * Compute a 1–7 star rating from the snapshot groups recorded when a signal fired.
 * Only conditions that PASSED contribute to the score.
 *
 * Algorithm:
 *   OR groups  → score each by passed-condition count + confirmation bonus;
 *                take the MAX (highest-scoring group wins)
 *   AND groups → sum passed conditions across all (always additive — they always fire)
 *   Bonus      → +0.5 per extra checkCandle on each passed condition
 *
 * Result clamped to [1, 7].
 */
export function signalScore(firedGroups: ConditionSnapshotGroup[]): number {
  const orGroups  = firedGroups.filter((g, i) => i === 0 || g.groupOperator === 'or');
  const andGroups = firedGroups.filter((g, i) => i  > 0 && g.groupOperator === 'and');

  function groupScore(g: ConditionSnapshotGroup): number {
    const passed = g.conditions.filter((c) => c.passed) as SnapshotItemWithCheck[];
    return passed.reduce((sum, c) => {
      const extra = Math.max(0, (c.checkCandles ?? 1) - 1);
      return sum + 1 + extra * 0.5;
    }, 0);
  }

  const orScores   = orGroups.map(groupScore);
  const bestOrScore = orScores.length > 0 ? Math.max(...orScores) : 0;
  const andScore   = andGroups.reduce((sum, g) => sum + groupScore(g), 0);

  return Math.min(7, Math.max(1, Math.round(bestOrScore + andScore)));
}

// ─── Structural score range ───────────────────────────────────────────────────

export interface ScoreRange {
  min: number;
  max: number;
}

/**
 * Compute the structural min/max possible score from a strategy definition
 * (no fire data — used when only the strategy definition is available).
 *
 * min = smallest active OR group's score (easiest firing path)
 *       + 1 per AND group (OR-within means at minimum 1 condition passes)
 *
 * max = largest active OR group's score (hardest path, all conditions pass)
 *       + full score of each AND group (all conditions pass)
 *
 * Result clamped to [1, 7] per bound.
 */
export function strategyScoreRange(entryGroups: ConditionGroup[]): ScoreRange {
  const activeGroups = entryGroups.filter((g) =>
    g.conditions.some((c) => c.enabled !== false),
  );
  if (activeGroups.length === 0) return { min: 1, max: 1 };

  const orGroups  = activeGroups.filter((g, i) => i === 0 || (g.operator ?? 'or') === 'or');
  const andGroups = activeGroups.filter((g, i) => i  > 0 &&  g.operator          === 'and');

  function condScore(g: ConditionGroup): number {
    return g.conditions
      .filter((c) => c.enabled !== false)
      .reduce((sum, c) => {
        const extra = Math.max(0, (c.checkCandles ?? 1) - 1);
        return sum + 1 + extra * 0.5;
      }, 0);
  }

  const orScores = orGroups.map(condScore);
  const minOr    = orScores.length > 0 ? Math.min(...orScores) : 1;
  const maxOr    = orScores.length > 0 ? Math.max(...orScores) : 1;

  // AND groups: min = 1 per group (only 1 condition needs to pass, OR-within)
  //             max = full score of all conditions
  const andMin = andGroups.length;
  const andMax = andGroups.reduce((sum, g) => sum + condScore(g), 0);

  return {
    min: Math.min(7, Math.max(1, Math.round(minOr + andMin))),
    max: Math.min(7, Math.max(1, Math.round(maxOr + andMax))),
  };
}

// ─── Backward-compat shim ────────────────────────────────────────────────────
// telegram.ts re-exports this; keep it so callers don't break during migration.

export function strategyRating(entryGroups: ConditionGroup[]): number {
  const { min, max } = strategyScoreRange(entryGroups);
  return Math.round((min + max) / 2);
}
