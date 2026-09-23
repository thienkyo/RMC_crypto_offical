import { Timeframe, Candle } from '@/types/market';
import { Strategy, StrategyCondition } from '@/types/strategy';
import { TF_TO_MS } from '@/lib/exchange/binance';
import { buildIndicatorCache, conditionCacheKey } from './evaluate';
import { INDICATORS } from '@/lib/indicators';

export type HtfCandleSets = Partial<Record<Timeframe, Candle[]>>;

/**
 * Returns distinct higher timeframes needed by the strategy's conditions.
 */
export function collectHtfTimeframes(strategy: Strategy): Timeframe[] {
  const tfs = new Set<Timeframe>();
  const allConditions = [
    ...strategy.entryConditions.flatMap(g => g.conditions),
    ...strategy.exitConditions.flatMap(g => g.conditions)
  ];

  for (const c of allConditions) {
    if (c.enabled === false) continue;
    if (c.timeframe && c.timeframe !== strategy.timeframe) {
      tfs.add(c.timeframe);
    }
  }

  return Array.from(tfs);
}

/**
 * Returns true if the strategy requires any higher timeframe evaluation.
 */
export function hasHtfConditions(strategy: Strategy): boolean {
  return collectHtfTimeframes(strategy).length > 0;
}

/**
 * Builds the indicator cache supporting Multi-Timeframe conditions.
 * Base TF conditions are delegated to standard buildIndicatorCache.
 * HTF conditions are computed on aligned HTF candle data to prevent lookahead.
 */
export function buildMtfIndicatorCache(
  strategy: Strategy,
  baseCandles: Candle[],
  htfCandles: HtfCandleSets
): Map<string, Map<number, number>> {
  const allConditions = [
    ...strategy.entryConditions.flatMap(g => g.conditions),
    ...strategy.exitConditions.flatMap(g => g.conditions)
  ];

  const baseConditions: StrategyCondition[] = [];
  const htfConditions: StrategyCondition[] = [];

  for (const c of allConditions) {
    if (c.enabled === false) continue;
    if (c.timeframe && c.timeframe !== strategy.timeframe) {
      htfConditions.push(c);
    } else {
      baseConditions.push(c);
    }
  }

  // Pre-build base cache
  const cache = buildIndicatorCache(baseConditions, baseCandles);

  // Group HTF conditions by timeframe to avoid duplicate indicator computation
  const htfByTimeframe = new Map<Timeframe, StrategyCondition[]>();
  for (const c of htfConditions) {
    const tf = c.timeframe!;
    if (!htfByTimeframe.has(tf)) {
      htfByTimeframe.set(tf, []);
    }
    htfByTimeframe.get(tf)!.push(c);
  }

  for (const [tf, conditions] of htfByTimeframe.entries()) {
    const rawHtfCandles = htfCandles[tf];
    if (!rawHtfCandles) {
      throw new Error(`Missing required HTF candle data for timeframe ${tf}`);
    }

    // Drop the last candle if it's forming (not closed). In a real environment, 
    // a forming HTF candle cannot be used for CLOSED-candle semantics.
    let htfArray = rawHtfCandles;
    if (htfArray.length > 0 && htfArray[htfArray.length - 1]!.closeTime > Date.now()) {
      htfArray = htfArray.slice(0, -1);
    }

    // Compute indicators for this TF
    const computedIndicators = new Map<string, any[]>();
    for (const c of conditions) {
      const cacheKey = conditionCacheKey(c);
      if (cache.has(cacheKey)) continue;

      const indicator = INDICATORS[c.indicatorId];
      if (!indicator) {
        console.warn(`[mtf] Unknown indicator: ${c.indicatorId}`);
        continue;
      }

      // Compute on HTF candles
      const indicatorKey = `${c.indicatorId}|${JSON.stringify(c.params)}`;
      if (!computedIndicators.has(indicatorKey)) {
        computedIndicators.set(indicatorKey, indicator.compute(htfArray, c.params));
      }

      const result = computedIndicators.get(indicatorKey)!;
      const series = result[c.seriesIndex];
      if (!series) {
        if (result.length > 0) {
          console.warn(`[mtf] Invalid seriesIndex=${c.seriesIndex} for ${c.indicatorId}`);
        }
        continue;
      }

      // Align HTF values onto base bar openTimes (no lookahead)
      const timeMap = new Map<number, number>();
      const htfLen = series.data.length;
      if (htfLen === 0) continue;

      let htfIdx = 0;
      const baseMs = TF_TO_MS[strategy.timeframe];
      const htfMs = TF_TO_MS[tf];

      for (const base of baseCandles) {
        const baseCloseTime = base.openTime + baseMs;
        
        // Advance htfIdx to the latest HTF candle that has fully closed
        // no later than the base candle has closed.
        while (htfIdx < htfLen - 1) {
          const nextHtfPoint = series.data[htfIdx + 1]!;
          const nextHtfCloseTime = nextHtfPoint.time + htfMs;
          if (nextHtfCloseTime <= baseCloseTime) {
            htfIdx++;
          } else {
            break;
          }
        }

        const htfPoint = series.data[htfIdx]!;
        const htfCloseTime = htfPoint.time + htfMs;

        // Ensure this HTF candle is actually closed relative to this base candle
        if (htfCloseTime <= baseCloseTime && !Number.isNaN(htfPoint.value)) {
          timeMap.set(base.openTime, htfPoint.value);
        }
      }

      cache.set(cacheKey, timeMap);
    }
  }

  return cache;
}
