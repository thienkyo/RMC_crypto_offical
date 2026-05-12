import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, isDoji, isLongBody, getAvgBodySize } from './utils';

export const abandonedBabyBearish: Indicator = {
  id: 'abandoned_baby_bearish',
  name: 'Abandoned Baby Bearish',
  description: 'A 3-candle bearish reversal: long green candle, doji gapping up (shadow gap), long red candle gapping down.',
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

      // Use separate averages: c1 is judged against the 10 bars before it,
      // c3 is judged against the 10 bars before c3 (i.e. at index i).
      const avgBodyC1 = getAvgBodySize(candles, i - 2, 10);
      const avgBodyC3 = getAvgBodySize(candles, i,     10);

      const isC1Match = isGreen(c1) && isLongBody(c1, avgBodyC1);
      const isC2Match = isDoji(c2)  && c2.low > c1.high;            // full shadow gap up
      const isC3Match = isRed(c3)   && isLongBody(c3, avgBodyC3) && c3.high < c2.low; // full shadow gap down

      const value = isC1Match && isC2Match && isC3Match ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     'ABB',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'abandoned_baby_bearish_signal',
      name:       'Abandoned Baby Bearish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};

export const abandonedBabyBullish: Indicator = {
  id: 'abandoned_baby_bullish',
  name: 'Abandoned Baby Bullish',
  description: 'A 3-candle bullish reversal: long red candle, doji gapping down (shadow gap), long green candle gapping up.',
  bias: 'bullish',
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

      const avgBodyC1 = getAvgBodySize(candles, i - 2, 10);
      const avgBodyC3 = getAvgBodySize(candles, i,     10);

      const isC1Match = isRed(c1)   && isLongBody(c1, avgBodyC1);
      const isC2Match = isDoji(c2)  && c2.high < c1.low;             // full shadow gap down
      const isC3Match = isGreen(c3) && isLongBody(c3, avgBodyC3) && c3.low > c2.high; // full shadow gap up

      const value = isC1Match && isC2Match && isC3Match ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#10b981',
          shape:    'arrowUp',
          size:     1,
          text:     'ABB',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'abandoned_baby_bullish_signal',
      name:       'Abandoned Baby Bullish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#10b981',
      markers,
    };

    return [series];
  },
};
