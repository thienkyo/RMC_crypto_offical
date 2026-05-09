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

/** Maps openTime (Unix ms) → indicator value at that bar. */
type TimeValueMap = Map<number, number>;

/** Stable cache key for a (indicator, params, seriesIndex) triple. */
function conditionCacheKey(c: StrategyCondition): string {
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
 * Evaluate one condition group — ALL conditions must be satisfied (AND).
 */
export function evaluateConditionGroup(
  group: ConditionGroup,
  candle: Candle,
  prevCandle: Candle | undefined,
  cache: Map<string, TimeValueMap>,
): boolean {
  if (group.conditions.length === 0) return false;
  return group.conditions.every((c) =>
    evaluateCondition(c, candle, prevCandle, cache),
  );
}

/**
 * Evaluate a list of condition groups — ANY group being satisfied triggers (OR).
 * Returns false when groups is empty (never fires).
 */
export function evaluateConditionGroups(
  groups: ConditionGroup[],
  candle: Candle,
  prevCandle: Candle | undefined,
  cache: Map<string, TimeValueMap>,
): boolean {
  if (groups.length === 0) return false;
  return groups.some((g) => evaluateConditionGroup(g, candle, prevCandle, cache));
}
