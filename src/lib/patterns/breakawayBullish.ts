import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, isLongBody, getAvgBodySize, bodySize } from './utils';

export const breakawayBullish: Indicator = {
  id: 'breakaway_bullish',
  name: 'Breakaway Bullish',
  description: 'A 5-candle bullish reversal pattern: A long red candle followed by three smaller decreasing candles, and finally a large green candle that engulfs the bodies of the previous three.',
  bias: 'bullish',
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
      // 1. C1 is a long red candle
      // 2. C2, C3, C4 are smaller red candles that trend downwards
      // 3. C5 is a long green candle that engulfs the bodies of C2, C3, and C4
      const isC1LongRed = isRed(c1) && isLongBody(c1, avgBody);
      const areC234Decreasing = isRed(c2) && isRed(c3) && isRed(c4) &&
                                 c2.close < c1.close && c3.close < c2.close && c4.close < c3.close;
      const areC234Small = bodySize(c2) < bodySize(c1) && bodySize(c3) < bodySize(c1) && bodySize(c4) < bodySize(c1);
      
      const isC5Engulfing = isGreen(c5) && c5.close > c2.open && c5.open < c4.close;

      const isBreakaway = isC1LongRed && areC234Decreasing && areC234Small && isC5Engulfing;

      const value = isBreakaway ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#10b981',
          shape:    'arrowUp',
          size:     1,
          text:     'BA',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'breakaway_bullish_signal',
      name:       'Breakaway Bullish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#10b981',
      markers,
    };

    return [series];
  },
};
