import type { Indicator, IndicatorResult, IndicatorSeries } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isDoji, isLongBody, getAvgBodySize } from './utils';

export const bearishDojiStar: Indicator = {
  id: 'bearish_doji_star',
  name: 'Bearish Doji Star',
  description: 'A 2-candle bearish reversal pattern: A long green candle followed by a Doji that opens and closes above the previous candle.',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[]): IndicatorResult {
    const data = candles.map((c, i) => {
      if (i < 1) return { time: c.openTime, value: 0 };
      
      const c1 = candles[i - 1]!;
      const c2 = c;
      
      const avgBody = getAvgBodySize(candles, i - 1, 10);
      
      if (!isGreen(c1) || !isLongBody(c1, avgBody)) {
        return { time: c.openTime, value: 0 };
      }
      
      if (!isDoji(c2)) {
        return { time: c.openTime, value: 0 };
      }
      
      // Opens and closes above the previous candle's body
      const c2BodyMin = Math.min(c2.open, c2.close);
      const c1BodyMax = Math.max(c1.open, c1.close); // which is c1.close since it's green
      
      const value = c2BodyMin > c1BodyMax ? 1 : 0;
      
      return { time: c.openTime, value };
    });

    const series: IndicatorSeries = {
      id: 'bearish_doji_star_signal',
      name: 'Bearish Doji Star',
      data,
      panel: 'sub',
      seriesType: 'histogram',
      color: '#ef4444',
    };

    return [series];
  }
};
