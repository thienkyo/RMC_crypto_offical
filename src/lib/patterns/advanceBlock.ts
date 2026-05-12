import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, bodySize, upperWick } from './utils';

export const advanceBlock: Indicator = {
  id: 'advance_block',
  name: 'Advance Block',
  description: 'A 3-candle bearish reversal: three green candles with progressively shorter bodies and progressively longer upper wicks, each opening within the prior candle\'s body.',
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

      if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);

      // Progressively shorter bodies
      if (!(b3 < b2 && b2 < b1)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const u1 = upperWick(c1);
      const u2 = upperWick(c2);
      const u3 = upperWick(c3);

      // Progressively longer upper wicks
      if (!(u3 > u2 && u2 > u1)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Each candle opens within the prior candle's body
      const opensInC1 = c2.open > c1.open && c2.open < c1.close;
      const opensInC2 = c3.open > c2.open && c3.open < c2.close;

      const value = opensInC1 && opensInC2 ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#f59e0b',  // amber — weakening bulls, not a full reversal signal
          shape:    'arrowDown',
          size:     1,
          text:     'AdvB',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'advance_block_signal',
      name:       'Advance Block',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
