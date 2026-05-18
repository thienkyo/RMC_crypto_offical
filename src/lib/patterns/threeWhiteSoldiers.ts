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
    'Three consecutive long bullish candles, each opening within the prior body and ' +
    'closing progressively higher with small upper wicks. Strong bullish reversal signal.',
  bias: 'bullish',
  defaultParams: {},
  paramsMeta: {},

  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data:    { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 2) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;

      // All three must be green
      if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

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
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Each close must be HIGHER than the prior close — staircase up
      if (!(c2.close > c1.close && c3.close > c2.close)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Each candle opens within the prior candle's body (near prior close)
      const openInBody2 = c2.open >= c1.open  && c2.open <= c1.close;
      const openInBody3 = c3.open >= c2.open  && c3.open <= c2.close;

      // Small upper wicks — soldiers close near their high (conviction)
      const smallUpperWick2 = upperWick(c2) < b2 * 0.3;
      const smallUpperWick3 = upperWick(c3) < b3 * 0.3;

      const value = (openInBody2 && openInBody3 && smallUpperWick2 && smallUpperWick3) ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
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
