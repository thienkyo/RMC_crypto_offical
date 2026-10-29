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

/** Stable cache key for a (indicator, params, seriesIndex, timeframe) tuple. */
export function conditionCacheKey(c: StrategyCondition): string {
  const base = `${c.indicatorId}|${c.seriesIndex}|${JSON.stringify(c.params)}`;
  return c.timeframe ? `${c.timeframe}|${base}` : base;  // old keys byte-identical
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
    // Strict series lookup. We previously fell back to result[0] when the
    // requested seriesIndex was out of range, but that silently re-routes
    // stale conditions to a different series (e.g. an old macd seriesIndex:3
    // would have evaluated against MACD Line). Skip instead, so the condition
    // simply returns false rather than firing against unrelated data.
    const series = result[condition.seriesIndex];
    if (!series) {
      if (result.length > 0) {
        console.warn(
          `[evaluate] Condition ${condition.id} requests seriesIndex=${condition.seriesIndex} on indicator '${condition.indicatorId}' which only has ${result.length} series — skipping (condition will never fire). Edit the condition to pick a valid series.`,
        );
      }
      continue;
    }

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

  // Option C Smart Split:
  // Indicators (RSI, BB %B, MACD, EMA, etc.) evaluate live on the forming bar.
  // Candlestick shape patterns anchor to the last completed bar (barIndex - 1)
  // while the live bar is < 75% complete, preventing early-bar fake candle shapes
  // while still letting the strategy fire intra-bar when indicators confirm.
  const isPattern = INDICATORS[condition.indicatorId]?.bias !== undefined;
  const bar = candles[barIndex];
  const now = Date.now();
  const isFormingBar = bar !== undefined && bar.closeTime > now;
  const barDuration = bar ? Math.max(1, bar.closeTime - bar.openTime) : 1;
  const formingProgress = isFormingBar && bar ? (now - bar.openTime) / barDuration : 1;
  const skipFormingPatternBar = isPattern && isFormingBar && formingProgress < 0.75 && barIndex > 0;

  if (mode === 'confirmation') {
    const effectiveBarIndex = skipFormingPatternBar ? barIndex - 1 : barIndex;
    // ALL of the last N candles (effectiveBarIndex-N+1 … effectiveBarIndex) must pass.
    for (let i = effectiveBarIndex; i > effectiveBarIndex - n; i--) {
      if (i < 0) return false;
      if (!evaluateCondition(condition, candles[i]!, candles[i - 1], cache)) return false;
    }
    return true;
  }

  // lookback: ANY of the last N candles [barIndex-N+1 … barIndex] must pass.
  // When skipFormingPatternBar is true, exclude the unformed barIndex without
  // shifting the tail back to barIndex-N (which caused signals to vanish on bar close).
  const startIdx = skipFormingPatternBar ? barIndex - 1 : barIndex;
  const endIdx   = Math.max(0, barIndex - n + 1);
  for (let i = startIdx; i >= endIdx; i--) {
    if (evaluateCondition(condition, candles[i]!, candles[i - 1], cache)) return true;
  }
  return false;
}

// ─── Regime-Aware Gate for Pure Level Groups ───────────────────────────────

interface RegimeData {
  plusDi:   Map<number, number>;
  minusDi:  Map<number, number>;
  rsi:      Map<number, number>;
  macdHist: Map<number, number>;
}

const regimeCache = new WeakMap<Candle[], RegimeData>();

/**
 * Lazily compute and cache ADX(+DI/-DI), RSI(14), and MACD histogram
 * for a candle series (at most once per candle array).
 */
export function getRegimeData(candles: Candle[]): RegimeData {
  const cached = regimeCache.get(candles);
  if (cached) return cached;

  const plusDi   = new Map<number, number>();
  const minusDi  = new Map<number, number>();
  const rsiMap   = new Map<number, number>();
  const macdHist = new Map<number, number>();

  if (candles.length >= 15) {
    try {
      const adxSeries = INDICATORS.adx?.compute(candles, { period: 14 });
      if (adxSeries?.[1]?.data && adxSeries?.[2]?.data) {
        for (const pt of adxSeries[1].data) plusDi.set(pt.time, pt.value);
        for (const pt of adxSeries[2].data) minusDi.set(pt.time, pt.value);
      }
    } catch {
      // non-fatal
    }

    try {
      const rsiSeries = INDICATORS.rsi?.compute(candles, { period: 14, emaPeriod: 0 });
      if (rsiSeries?.[0]?.data) {
        for (const pt of rsiSeries[0].data) rsiMap.set(pt.time, pt.value);
      }
    } catch {
      // non-fatal
    }

    try {
      const macdSeries = INDICATORS.macd?.compute(candles, { fast: 12, slow: 26, signal: 9, trendEma: 200 });
      if (macdSeries?.[2]?.data) {
        for (const pt of macdSeries[2].data) macdHist.set(pt.time, pt.value);
      }
    } catch {
      // non-fatal
    }
  }

  const data: RegimeData = { plusDi, minusDi, rsi: rsiMap, macdHist };
  regimeCache.set(candles, data);
  return data;
}

/**
 * A "pure level" group consists solely of static indicator thresholds
 * (e.g. RSI < 40, BB %B < 0.09) with no crossover operators (crosses_above/below)
 * and no candlestick patterns.
 */
export function isLevelGroup(group: ConditionGroup): boolean {
  const active = group.conditions.filter((c) => c.enabled !== false);
  if (active.length === 0) return false;
  return active.every((c) => {
    if (String(c.operator).startsWith('crosses')) return false;
    const ind = INDICATORS[c.indicatorId];
    if (ind && ind.bias !== undefined) return false;
    return true;
  });
}

/**
 * Regime-Aware Gate for pure level condition groups:
 *
 *   LONG in Bear Regime (-DI > +DI):
 *     Requires reversal confirmation (green candle + RSI rising + MACD histogram rising).
 *     Prevents catching falling knives on repeated oversold bars.
 *
 *   SHORT in Bull Regime (+DI > -DI):
 *     Requires reversal confirmation (red candle + RSI falling + MACD histogram falling).
 *     Prevents shorting into parabolic vertical expansions on repeated overbought bars.
 *
 * When trend direction aligns with the trade (or if the group has crossover/pattern triggers),
 * the signal passes immediately with zero delay.
 */
export function passesRegimeGate(
  group:     ConditionGroup,
  candles:   Candle[],
  barIndex:  number,
  direction?: 'long' | 'short',
): boolean {
  if (!direction || barIndex <= 0) return true;
  if (!isLevelGroup(group)) return true;

  const cur = candles[barIndex];
  const prev = candles[barIndex - 1];
  if (!cur || !prev) return true;

  const regime = getRegimeData(candles);
  const p = regime.plusDi.get(cur.openTime) ?? 0;
  const m = regime.minusDi.get(cur.openTime) ?? 0;
  if (p === 0 && m === 0) return true; // ADX warm-up safeguard

  const rCur = regime.rsi.get(cur.openTime) ?? 0;
  const rPrev = regime.rsi.get(prev.openTime) ?? 0;
  const mhCur = regime.macdHist.get(cur.openTime) ?? 0;
  const mhPrev = regime.macdHist.get(prev.openTime) ?? 0;

  const now = Date.now();
  const isFormingBar = cur.closeTime > now;
  const barDuration = Math.max(1, cur.closeTime - cur.openTime);
  const formingProgress = isFormingBar ? (now - cur.openTime) / barDuration : 1;

  if (direction === 'long') {
    if (m > p) {
      const isGreen = cur.close > cur.open;
      const rsiUp   = rCur > rPrev;
      const macdUp  = mhCur > mhPrev;
      // Intra-bar flicker guard: on an unclosed forming bar during a bear regime,
      // prevent early head-fakes from firing unless either:
      //  1) The bar has matured to at least 15% of its duration, OR
      //  2) Price has decisively reclaimed above the prior candle's body midpoint.
      const prevMid = (prev.open + prev.close) / 2;
      const progressOk = !isFormingBar || formingProgress >= 0.15 || cur.close >= prevMid;
      return isGreen && rsiUp && macdUp && progressOk;
    }
    return true;
  }

  if (direction === 'short') {
    if (p > m) {
      const isRed    = cur.close < cur.open;
      const rsiDown  = rCur < rPrev;
      const macdDown = mhCur < mhPrev;
      const prevMid  = (prev.open + prev.close) / 2;
      const progressOk = !isFormingBar || formingProgress >= 0.15 || cur.close <= prevMid;
      return isRed && rsiDown && macdDown && progressOk;
    }
    return true;
  }

  return true;
}

/**
 * Evaluate one condition group at `barIndex` using its conditionOperator
 * (AND/OR within group), honouring checkMode + checkCandles per condition
 * and applying the regime-aware gate for pure level groups.
 */
export function evaluateConditionGroupChecked(
  group:     ConditionGroup,
  candles:   Candle[],
  barIndex:  number,
  cache:     Map<string, TimeValueMap>,
  direction?: 'long' | 'short',
): boolean {
  const active = group.conditions.filter((c) => c.enabled !== false);
  if (active.length === 0) return false;
  const op = resolveConditionOperator(group);
  const passesConditions = op === 'or'
    ? active.some((c)  => evaluateConditionChecked(c, candles, barIndex, cache))
    : active.every((c) => evaluateConditionChecked(c, candles, barIndex, cache));
  if (!passesConditions) return false;
  return passesRegimeGate(group, candles, barIndex, direction);
}

/**
 * Evaluate a list of condition groups at `barIndex` using the OR/AND split logic.
 */
export function evaluateConditionGroupsChecked(
  groups:    ConditionGroup[],
  candles:   Candle[],
  barIndex:  number,
  cache:     Map<string, TimeValueMap>,
  direction?: 'long' | 'short',
): boolean {
  return combineGroupResults(groups, (g) =>
    evaluateConditionGroupChecked(g, candles, barIndex, cache, direction),
  );
}
