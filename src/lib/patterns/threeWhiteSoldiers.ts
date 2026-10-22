/**
 * Three White Soldiers — bullish reversal pattern.
 *
 * Three consecutive long green (bullish) candles, each:
 *   1. Opening within or near the body of the prior candle.
 *   2. Closing progressively higher than the prior close (staircase up).
 *   3. Having a similar body size to its neighbours (within 30% of avg).
 *   4. Closing near its high — small upper wick (< 30% of body size).
 *
 * Context: strongest when it appears after a downtrend or at a support level.
 * Mirror pattern of Identical Three Crows (bearish).
 */
import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, bodySize, upperWick } from './utils';

export const threeWhiteSoldiers: Indicator = {
  id:   'three_white_soldiers',
  name: 'Three White Soldiers',
  description:
    'Three long bullish candles within the lookback window (default 3 of 5 candles), ' +
    'closing progressively higher with small upper wicks. Allows 1–2 pause candles in between.',
  bias: 'bullish',
  defaultParams: { window: 5 },
  paramsMeta: {
    window: { label: 'Window (3 of N)', min: 3, max: 10, step: 1 },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const windowSize = Math.max(3, Math.min(15, Math.round(params['window'] ?? 5)));
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    function isValidTriplet(
      c1: Candle,
      c2: Candle,
      c3: Candle,
      consecutive12: boolean,
      consecutive23: boolean,
      windowSlice: Candle[],
    ): boolean {
      if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) return false;

      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);

      // Similar body sizes (within 30% of their average)
      const avgB = (b1 + b2 + b3) / 3;
      if (
        avgB === 0 ||
        Math.abs(b1 - avgB) > avgB * 0.3 ||
        Math.abs(b2 - avgB) > avgB * 0.3 ||
        Math.abs(b3 - avgB) > avgB * 0.3
      ) {
        return false;
      }

      // Each soldier close must be HIGHER than the prior soldier close — staircase up
      if (!(c2.close > c1.close && c3.close > c2.close)) return false;

      // When consecutive, open within prior body; when separated by a pause bar, open >= prior soldier open
      const openOk2 = consecutive12
        ? c2.open >= c1.open && c2.open <= c1.close
        : c2.open >= c1.open && c2.open <= c1.close * 1.01;
      const openOk3 = consecutive23
        ? c3.open >= c2.open && c3.open <= c2.close
        : c3.open >= c2.open && c3.open <= c2.close * 1.01;

      if (!openOk2 || !openOk3) return false;

      // Small upper wicks — soldiers close near their high (conviction)
      const smallUpperWick2 = upperWick(c2) < b2 * 0.3;
      const smallUpperWick3 = upperWick(c3) < b3 * 0.3;
      if (!smallUpperWick2 || !smallUpperWick3) return false;

      // Ensure no pause candle in between broke below the first soldier's open
      for (const bar of windowSlice) {
        if (bar.close < c1.open) return false;
      }

      return true;
    }

    for (let i = 0; i < candles.length; i++) {
      const c3 = candles[i]!;

      if (i < 2) {
        data.push({ time: c3.openTime, value: 0 });
        continue;
      }

      const startIdx = Math.max(0, i - windowSize + 1);
      let matched = false;

      if (isGreen(c3)) {
        for (let idx1 = startIdx; idx1 <= i - 2 && !matched; idx1++) {
          for (let idx2 = idx1 + 1; idx2 <= i - 1 && !matched; idx2++) {
            const c1 = candles[idx1]!;
            const c2 = candles[idx2]!;
            const slice = candles.slice(idx1, i + 1);
            if (isValidTriplet(c1, c2, c3, idx2 === idx1 + 1, i === idx2 + 1, slice)) {
              matched = true;
            }
          }
        }
      }

      const value = matched ? 1 : 0;
      data.push({ time: c3.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c3.openTime,
          position: 'belowBar',
          color:    '#22c55e',
          shape:    'arrowUp',
          size:     1,
          text:     '3W',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'three_white_soldiers_signal',
      name:       'Three White Soldiers',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#22c55e',
      markers,
    };

    return [series];
  },
};
