/**
 * Hammer & Shooting Star single-candle reversal patterns.
 *
 * HAMMER  (bullish reversal from downtrend)
 *   • Small real body in the upper half of the candle range.
 *   • Long lower wick ≥ 2× the body size.
 *   • Little or no upper wick (≤ 10% of body size).
 *   • Works on any colour (though green is a stronger signal).
 *   Interpretation: sellers pushed the price down hard intrabar but buyers
 *   recovered completely, signalling demand absorption.
 *
 * SHOOTING STAR  (bearish reversal from uptrend)
 *   Mirror of Hammer:
 *   • Small real body in the lower half of the candle range.
 *   • Long upper wick ≥ 2× the body size.
 *   • Little or no lower wick (≤ 10% of body size).
 *   Interpretation: buyers pushed price up hard intrabar but sellers crushed
 *   it back down, signalling supply exhaustion.
 *
 * Both patterns are most reliable after a clear directional move and near a
 * key support / resistance level.
 */
import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { bodySize, upperWick, lowerWick, candleSize } from './utils';

// ─── Hammer ───────────────────────────────────────────────────────────────────

export const hammer: Indicator = {
  id:   'hammer',
  name: 'Hammer',
  description:
    'Hammer candle pattern. Small body at the top of the range with a long lower ' +
    'wick (≥ 2× the body) and virtually no upper wick. Bullish reversal signal — ' +
    'sellers tried to push price down but buyers absorbed the selling pressure.',
  bias: 'bullish',
  defaultParams: {},
  paramsMeta: {},

  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c    = candles[i]!;
      const body = bodySize(c);
      const lo   = lowerWick(c);
      const hi   = upperWick(c);
      const total = candleSize(c);

      // Must have some range to avoid flat/doji candles
      if (total === 0 || body === 0) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Lower wick must be at least 2× the body
      const longLowerWick = lo >= body * 2;
      // Upper wick must be small — at most 10% of body
      const smallUpperWick = hi <= body * 0.1;
      // Body must sit in the upper third of the total range
      // i.e. the low of the body is at least 60% up from the candle low
      const bodyLow  = Math.min(c.open, c.close);
      const bodyInUpperRange = (bodyLow - c.low) / total >= 0.6;

      const value = (longLowerWick && smallUpperWick && bodyInUpperRange) ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#22c55e',
          shape:    'arrowUp',
          size:     1,
          text:     '⚒',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'hammer_signal',
      name:       'Hammer',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#22c55e',
      markers,
    };

    return [series];
  },
};

// ─── Shooting Star ────────────────────────────────────────────────────────────

export const shootingStar: Indicator = {
  id:   'shooting_star',
  name: 'Shooting Star',
  description:
    'Shooting Star candle pattern. Small body at the bottom of the range with a ' +
    'long upper wick (≥ 2× the body) and virtually no lower wick. Bearish reversal ' +
    'signal — buyers tried to push price up but sellers overwhelmed the demand.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},

  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c     = candles[i]!;
      const body  = bodySize(c);
      const hi    = upperWick(c);
      const lo    = lowerWick(c);
      const total = candleSize(c);

      if (total === 0 || body === 0) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Upper wick must be at least 2× the body
      const longUpperWick = hi >= body * 2;
      // Lower wick must be small — at most 10% of body
      const smallLowerWick = lo <= body * 0.1;
      // Body must sit in the lower third of the total range
      const bodyHigh = Math.max(c.open, c.close);
      const bodyInLowerRange = (c.high - bodyHigh) / total >= 0.6;

      const value = (longUpperWick && smallLowerWick && bodyInLowerRange) ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     '★',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'shooting_star_signal',
      name:       'Shooting Star',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
