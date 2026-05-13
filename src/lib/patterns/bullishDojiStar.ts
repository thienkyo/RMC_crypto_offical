import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isRed, isDoji, isLongBody, getAvgBodySize } from './utils';

export const bullishDojiStar: Indicator = {
  id: 'bullish_doji_star',
  name: 'Bullish Doji Star',
  description: 'A 2-candle bullish reversal pattern: A long red candle followed by a Doji that gaps down and remains below the previous candle\'s body.',
  bias: 'bullish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 1) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c1 = candles[i - 1]!;
      const c2 = c;

      const avgBody = getAvgBodySize(candles, i - 1, 10);

      // Condition:
      // 1. C1 is a long red candle
      // 2. C2 is a Doji
      // 3. C2 gaps down (high is below C1's close)
      const isC1LongRed = isRed(c1) && isLongBody(c1, avgBody);
      const isC2Doji = isDoji(c2);
      const isGapDown = c2.high < c1.close;

      const isBullishDojiStar = isC1LongRed && isC2Doji && isGapDown;

      const value = isBullishDojiStar ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#10b981',
          shape:    'arrowUp',
          size:     1,
          text:     'DS',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'bullish_doji_star_signal',
      name:       'Bullish Doji Star',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#10b981',
      markers,
    };

    return [series];
  },
};
