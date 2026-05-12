import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isRed, bodySize } from './utils';

export const identicalThreeCrows: Indicator = {
  id: 'identical_three_crows',
  name: 'Identical Three Crows',
  description: 'A 3-candle bearish pattern: Three consecutive red candles with similar sizes, each opening near the previous close, and each closing lower than the prior close.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
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

      // All three must be red
      if (!isRed(c1) || !isRed(c2) || !isRed(c3)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);

      // Similar body sizes (within 30% of the average)
      const avgB = (b1 + b2 + b3) / 3;
      if (
        Math.abs(b1 - avgB) > avgB * 0.3 ||
        Math.abs(b2 - avgB) > avgB * 0.3 ||
        Math.abs(b3 - avgB) > avgB * 0.3
      ) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Each close must be LOWER than the prior close — staircase down.
      // Without this check, three sideways red candles at the same price level
      // would incorrectly pass.
      if (!(c2.close < c1.close && c3.close < c2.close)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Each candle opens near the previous close (within 15% of that body)
      const openNearClose2 = Math.abs(c2.open - c1.close) <= b1 * 0.15;
      const openNearClose3 = Math.abs(c3.open - c2.close) <= b2 * 0.15;

      const value = openNearClose2 && openNearClose3 ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     '3C',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'identical_three_crows_signal',
      name:       'Identical Three Crows',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
