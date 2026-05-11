import type { Indicator, IndicatorResult, IndicatorSeries } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, bodySize, upperWick } from './utils';

export const advanceBlock: Indicator = {
  id: 'advance_block',
  name: 'Advance Block',
  description: 'A 3-candle bearish reversal pattern: Three green candles with progressively shorter bodies and progressively longer upper wicks.',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[]): IndicatorResult {
    const data = candles.map((c, i) => {
      if (i < 2) return { time: c.openTime, value: 0 };
      
      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;
      
      if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) {
        return { time: c.openTime, value: 0 };
      }
      
      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);
      
      // Progressively shorter bodies
      if (!(b3 < b2 && b2 < b1)) {
        return { time: c.openTime, value: 0 };
      }
      
      const u1 = upperWick(c1);
      const u2 = upperWick(c2);
      const u3 = upperWick(c3);
      
      // Progressively longer upper wicks
      if (!(u3 > u2 && u2 > u1)) {
        return { time: c.openTime, value: 0 };
      }
      
      // Opens within the previous body
      const opensInC1 = c2.open > c1.open && c2.open < c1.close;
      const opensInC2 = c3.open > c2.open && c3.open < c2.close;
      
      const value = opensInC1 && opensInC2 ? 1 : 0;
      
      return { time: c.openTime, value };
    });

    const series: IndicatorSeries = {
      id: 'advance_block_signal',
      name: 'Advance Block',
      data,
      panel: 'sub',
      seriesType: 'histogram',
      color: '#ef4444',
    };

    return [series];
  }
};
