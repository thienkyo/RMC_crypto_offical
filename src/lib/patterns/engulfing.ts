/**
 * Bullish & Bearish Engulfing patterns.
 *
 * BULLISH ENGULFING
 *   A 2-candle reversal pattern:
 *   1. Prior candle is bearish (red).
 *   2. Current candle is bullish (green) with a body that completely engulfs
 *      the prior candle's body (open ≤ prior close AND close ≥ prior open).
 *   3. Current body is meaningfully larger than the prior body (≥ 1.1×) to
 *      avoid false signals from near-doji pairs.
 *   Context: strong when it appears at a support level or after a downtrend.
 *
 * BEARISH ENGULFING
 *   Mirror of Bullish Engulfing:
 *   1. Prior candle is bullish (green).
 *   2. Current candle is bearish (red) and its body fully engulfs the prior body.
 *   Context: strong at resistance levels or after an uptrend.
 */
import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, bodySize } from './utils';

// ─── Bullish Engulfing ────────────────────────────────────────────────────────

export const bullishEngulfing: Indicator = {
  id:   'bullish_engulfing',
  name: 'Bullish Engulfing',
  description:
    'Bullish Engulfing pattern. A large green candle whose body fully swallows ' +
    'the previous red candle\'s body. Strong bullish reversal signal at support.',
  bias: 'bullish',
  defaultParams: {},
  paramsMeta: {},

  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 1) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const prev = candles[i - 1]!;

      // Prior must be bearish, current must be bullish
      if (!isRed(prev) || !isGreen(c)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Current body fully engulfs prior body
      // Green open ≤ prior (red) close  AND  green close ≥ prior (red) open
      const engulfs = c.open <= prev.close && c.close >= prev.open;

      // Current body must be at least 10% larger to avoid near-equal candles
      const meaningful = bodySize(prev) === 0 || bodySize(c) >= bodySize(prev) * 1.1;

      const value = (engulfs && meaningful) ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#22c55e',
          shape:    'arrowUp',
          size:     1,
          text:     'BE↑',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'bullish_engulfing_signal',
      name:       'Bullish Engulfing',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#22c55e',
      markers,
    };

    return [series];
  },
};

// ─── Bearish Engulfing ────────────────────────────────────────────────────────

export const bearishEngulfing: Indicator = {
  id:   'bearish_engulfing',
  name: 'Bearish Engulfing',
  description:
    'Bearish Engulfing pattern. A large red candle whose body fully swallows ' +
    'the previous green candle\'s body. Strong bearish reversal signal at resistance.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},

  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 1) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const prev = candles[i - 1]!;

      // Prior must be bullish, current must be bearish
      if (!isGreen(prev) || !isRed(c)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Current body fully engulfs prior body
      // Red open ≥ prior (green) close  AND  red close ≤ prior (green) open
      const engulfs = c.open >= prev.close && c.close <= prev.open;

      // Current body must be at least 10% larger
      const meaningful = bodySize(prev) === 0 || bodySize(c) >= bodySize(prev) * 1.1;

      const value = (engulfs && meaningful) ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     'BE↓',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'bearish_engulfing_signal',
      name:       'Bearish Engulfing',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
