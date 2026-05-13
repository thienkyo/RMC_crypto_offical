import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, isLongBody, getAvgBodySize, bodySize } from './utils';

export const breakawayBearish: Indicator = {
  id: 'breakaway_bearish',
  name: 'Breakaway Bearish',
  description: 'A 5-candle bearish reversal pattern: A long green candle followed by three smaller increasing candles, and finally a large red candle that engulfs the bodies of the previous three.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 4) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c1 = candles[i - 4]!;
      const c2 = candles[i - 3]!;
      const c3 = candles[i - 2]!;
      const c4 = candles[i - 1]!;
      const c5 = c;

      const avgBody = getAvgBodySize(candles, i - 4, 10);

      // Condition:
      // 1. C1 is a long green candle
      // 2. C2, C3, C4 are smaller green candles that trend upwards
      // 3. C5 is a long red candle that engulfs the bodies of C2, C3, and C4
      const isC1LongGreen = isGreen(c1) && isLongBody(c1, avgBody);
      const areC234Increasing = isGreen(c2) && isGreen(c3) && isGreen(c4) &&
                                 c2.close > c1.close && c3.close > c2.close && c4.close > c3.close;
      const areC234Small = bodySize(c2) < bodySize(c1) && bodySize(c3) < bodySize(c1) && bodySize(c4) < bodySize(c1);
      
      const isC5Engulfing = isRed(c5) && c5.close < c2.open && c5.open > c4.close;

      const isBreakaway = isC1LongGreen && areC234Increasing && areC234Small && isC5Engulfing;

      const value = isBreakaway ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     'BA',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'breakaway_bearish_signal',
      name:       'Breakaway Bearish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
