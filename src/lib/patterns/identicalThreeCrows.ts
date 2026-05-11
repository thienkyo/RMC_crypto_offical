import type { Indicator, IndicatorResult, IndicatorSeries } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isRed, bodySize } from './utils';

export const identicalThreeCrows: Indicator = {
  id: 'identical_three_crows',
  name: 'Identical Three Crows',
  description: 'A 3-candle bearish pattern: Three consecutive red candles with similar sizes, where each opens near the previous close.',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[]): IndicatorResult {
    const data = candles.map((c, i) => {
      if (i < 2) return { time: c.openTime, value: 0 };
      
      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;
      
      // All three must be red
      if (!isRed(c1) || !isRed(c2) || !isRed(c3)) {
        return { time: c.openTime, value: 0 };
      }
      
      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);
      
      // Similar body sizes (within 30% of each other roughly)
      const avgB = (b1 + b2 + b3) / 3;
      if (Math.abs(b1 - avgB) > avgB * 0.3 || Math.abs(b2 - avgB) > avgB * 0.3 || Math.abs(b3 - avgB) > avgB * 0.3) {
        return { time: c.openTime, value: 0 };
      }
      
      // Open near the previous close
      const openNearClose2 = Math.abs(c2.open - c1.close) <= b1 * 0.15;
      const openNearClose3 = Math.abs(c3.open - c2.close) <= b2 * 0.15;
      
      const value = openNearClose2 && openNearClose3 ? 1 : 0;
      
      return { time: c.openTime, value };
    });

    const series: IndicatorSeries = {
      id: 'identical_three_crows_signal',
      name: 'Identical Three Crows',
      data,
      panel: 'sub',
      seriesType: 'histogram',
      color: '#ef4444',
    };

    return [series];
  }
};
