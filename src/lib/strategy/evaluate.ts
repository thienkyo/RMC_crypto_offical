/**
 * Strategy condition evaluator.
 *
 * Design:
 *  1. Pre-compute all required indicator series once over the full candle array.
 *  2. Build a time-indexed cache:  cacheKey → Map<openTime, value>
 *  3. For each bar, look up the value directly from the cache — O(1) per condition.
 *
 * This means even a strategy with 10 conditions runs each indicator only once,
 * not once per bar — critical for backtesting over thousands of candles.
 */

import { INDICATORS } from '@/lib/indicators';
import type { Candle } from '@/types/market';
import type { StrategyCondition, ConditionGroup } from '@/types/strategy';

// ─── Group operator helpers ───────────────────────────────────────────────────

/**
 * Resolve the intra-group condition operator.
 * OR groups default to AND inside; AND groups default to OR inside.
 * An explicit conditionOperator always wins.
 */
function resolveConditionOperator(group: ConditionGroup): 'and' | 'or' {
  if (group.conditionOperator !== undefined) return group.conditionOperator;
  return group.operator === 'and' ? 'or' : 'and';
}

/**
 * Combine group results using the OR/AND split logic:
 *   • At least one OR group must fire  (or there are none)
 *   • Every AND group must fire        (or there are none)
 *
 * The first group (index 0) is always treated as OR regardless of its stored
 * operator — it is the primary entry setup and its role is fixed.
 */
function combineGroupResults(
  groups: ConditionGroup[],
  evaluate: (g: ConditionGroup) => boolean,
): boolean {
  if (groups.length === 0) return false;
  // Index 0 is always OR — force it regardless of stored operator value.
  const orGroups  = groups.filter((g, i) => i === 0 || (g.operator ?? 'or') === 'or');
  const andGroups = groups.filter((g, i) => i  >  0 &&  g.operator           === 'and');
  const orPasses  = orGroups.length === 0 || orGroups.some((g) => evaluate(g));
  const andPasses = andGroups.every((g) => evaluate(g));
  return orPasses && andPasses;
}

/** Maps openTime (Unix ms) → indicator value at that bar. */
type TimeValueMap = Map<number, number>;

/** Stable cache key for a (indicator, params, seriesIndex) triple. */
export function conditionCacheKey(c: StrategyCondition): string {
  return `${c.indicatorId}|${c.seriesIndex}|${JSON.stringify(c.params)}`;
}

/**
 * Pre-compute all indicator series referenced by the given conditions.
 * Returns a map from cache key to a time-indexed value map.
 *
 * Call once per backtest run; pass the result to evaluateConditionGroups.
 */
export function buildIndicatorCache(
  conditions: StrategyCondition[],
  candles: Candle[],
): Map<string, TimeValueMap> {
  const cache = new Map<string, TimeValueMap>();

  for (const condition of conditions) {
    if (condition.enabled === false) continue; // skip disabled conditions
    const key = conditionCacheKey(condition);
    if (cache.has(key)) continue; // already computed

    const indicator = INDICATORS[condition.indicatorId];
    if (!indicator) {
      console.warn(`[evaluate] Unknown indicator: ${condition.indicatorId}`);
      continue;
    }

    const result = indicator.compute(candles, condition.params);
    const series = result[condition.seriesIndex] ?? result[0];
    if (!series) continue;

    const timeMap: TimeValueMap = new Map();
    for (const point of series.data) {
      // NaN values (from EMA warm-up padding) should not match any condition
      if (!Number.isNaN(point.value)) {
        timeMap.set(point.time, point.value);
      }
    }
    cache.set(key, timeMap);
  }

  return cache;
}

/**
 * Evaluate a single condition at the current bar.
 *
 * @param condition - The condition to test.
 * @param candle    - The current bar being evaluated.
 * @param prevCandle - The previous bar (needed for crosses_above / crosses_below).
 * @param cache     - Pre-built indicator cache from buildIndicatorCache().
 */
export function evaluateCondition(
  condition: StrategyCondition,
  candle: Candle,
  prevCandle: Candle | undefined,
  cache: Map<string, TimeValueMap>,
): boolean {
  const key = conditionCacheKey(condition);
  const timeMap = cache.get(key);
  if (!timeMap) return false;

  const current = timeMap.get(candle.openTime);
  if (current === undefined) return false; // indicator not warm yet

  const { operator, value } = condition;

  if (operator === 'crosses_above') {
    if (!prevCandle) return false;
    const prev = timeMap.get(prevCandle.openTime);
    if (prev === undefined) return false;
    return prev <= value && current > value;
  }

  if (operator === 'crosses_below') {
    if (!prevCandle) return false;
    const prev = timeMap.get(prevCandle.openTime);
    if (prev === undefined) return false;
    return prev >= value && current < value;
  }

  switch (operator) {
    case 'gt':  return current > value;
    case 'lt':  return current < value;
    case 'gte': return current >= value;
    case 'lte': return current <= value;
    default:    return false;
  }
}

/**
 * Evaluate one condition group using its conditionOperator (AND/OR within group).
 * Disabled conditions are skipped.
 * A group with no active conditions returns false (never fires).
 */
export function evaluateConditionGroup(
  group: ConditionGroup,
  candle: Candle,
  prevCandle: Candle | undefined,
  cache: Map<string, TimeValueMap>,
): boolean {
  const active = group.conditions.filter((c) => c.enabled !== false);
  if (active.length === 0) return false;
  const op = resolveConditionOperator(group);
  return op === 'or'
    ? active.some((c)  => evaluateCondition(c, candle, prevCandle, cache))
    : active.every((c) => evaluateCondition(c, candle, prevCandle, cache));
}

/**
 * Evaluate a list of condition groups using the OR/AND split logic.
 * Returns false when groups is empty (never fires).
 */
export function evaluateConditionGroups(
  groups: ConditionGroup[],
  candle: Candle,
  prevCandle: Candle | undefined,
  cache: Map<string, TimeValueMap>,
): boolean {
  return combineGroupResults(groups, (g) =>
    evaluateConditionGroup(g, candle, prevCandle, cache),
  );
}

// ─── Window-aware evaluation (respects checkMode + checkCandles) ─────────────
//
// These are the canonical functions used by the backtester, chart signal
// computation, and the notify cron — all three paths must agree on when a
// condition fires, otherwise the backtest shows different trade counts than
// what actually gets sent to Telegram.
//
// 'confirmation' (default), N:
//   The condition must hold on ALL of the last N consecutive closed candles
//   ending at barIndex.  checkCandles = 1 is equivalent to the single-bar check.
//
// 'lookback', N:
//   The condition must have been true on AT LEAST ONE of the last N candles.

/**
 * Evaluate a single condition at bar `barIndex`, honouring its
 * `checkMode` + `checkCandles` window.
 */
export function evaluateConditionChecked(
  condition: StrategyCondition,
  candles:   Candle[],
  barIndex:  number,
  cache:     Map<string, TimeValueMap>,
): boolean {
  const mode = condition.checkMode    ?? 'confirmation';
  const n    = Math.max(1, condition.checkCandles ?? 1);

  if (mode === 'confirmation') {
    // ALL of the last N candles (barIndex-N+1 … barIndex) must pass.
    for (let i = barIndex; i > barIndex - n; i--) {
      if (i < 0) return false;
      if (!evaluateCondition(condition, candles[i]!, candles[i - 1], cache)) return false;
    }
    return true;
  }

  // lookback: ANY of the last N candles must pass.
  for (let i = barIndex; i >= Math.max(0, barIndex - n + 1); i--) {
    if (evaluateCondition(condition, candles[i]!, candles[i - 1], cache)) return true;
  }
  return false;
}

/**
 * Evaluate one condition group at `barIndex` using its conditionOperator
 * (AND/OR within group), honouring checkMode + checkCandles per condition.
 */
export function evaluateConditionGroupChecked(
  group:    ConditionGroup,
  candles:  Candle[],
  barIndex: number,
  cache:    Map<string, TimeValueMap>,
): boolean {
  const active = group.conditions.filter((c) => c.enabled !== false);
  if (active.length === 0) return false;
  const op = resolveConditionOperator(group);
  return op === 'or'
    ? active.some((c)  => evaluateConditionChecked(c, candles, barIndex, cache))
    : active.every((c) => evaluateConditionChecked(c, candles, barIndex, cache));
}

/**
 * Evaluate a list of condition groups at `barIndex` using the OR/AND split logic.
 */
export function evaluateConditionGroupsChecked(
  groups:   ConditionGroup[],
  candles:  Candle[],
  barIndex: number,
  cache:    Map<string, TimeValueMap>,
): boolean {
  return combineGroupResults(groups, (g) =>
    evaluateConditionGroupChecked(g, candles, barIndex, cache),
  );
}
