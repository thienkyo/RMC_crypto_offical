import type { Indicator, IndicatorResult, IndicatorSeries } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, isDoji, isLongBody, getAvgBodySize } from './utils';

export const abandonedBabyBearish: Indicator = {
  id: 'abandoned_baby_bearish',
  name: 'Abandoned Baby Bearish',
  description: 'A 3-candle bearish reversal pattern: A long green candle, followed by a Doji that gaps up, followed by a long red candle that gaps down.',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[]): IndicatorResult {
    const data = candles.map((c, i) => {
      if (i < 2) return { time: c.openTime, value: 0 };
      
      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;
      
      const avgBody = getAvgBodySize(candles, i - 2, 10);
      
      const isC1Match = isGreen(c1) && isLongBody(c1, avgBody);
      const isC2Match = isDoji(c2) && c2.low > c1.high; // gap up
      const isC3Match = isRed(c3) && isLongBody(c3, avgBody) && c3.high < c2.low; // gap down
      
      const value = isC1Match && isC2Match && isC3Match ? 1 : 0;
      
      return { time: c.openTime, value };
    });

    const series: IndicatorSeries = {
      id: 'abandoned_baby_bearish_signal',
      name: 'Abandoned Baby Bearish',
      data,
      panel: 'sub',
      seriesType: 'histogram',
      color: '#ef4444', // red
    };

    return [series];
  }
};

export const abandonedBabyBullish: Indicator = {
  id: 'abandoned_baby_bullish',
  name: 'Abandoned Baby Bullish',
  description: 'A 3-candle bullish reversal pattern: A long red candle, followed by a Doji that gaps down, followed by a long green candle that gaps up.',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[]): IndicatorResult {
    const data = candles.map((c, i) => {
      if (i < 2) return { time: c.openTime, value: 0 };
      
      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;
      
      const avgBody = getAvgBodySize(candles, i - 2, 10);
      
      const isC1Match = isRed(c1) && isLongBody(c1, avgBody);
      const isC2Match = isDoji(c2) && c2.high < c1.low; // gap down
      const isC3Match = isGreen(c3) && isLongBody(c3, avgBody) && c3.low > c2.high; // gap up
      
      const value = isC1Match && isC2Match && isC3Match ? 1 : 0;
      
      return { time: c.openTime, value };
    });

    const series: IndicatorSeries = {
      id: 'abandoned_baby_bullish_signal',
      name: 'Abandoned Baby Bullish',
      data,
      panel: 'sub',
      seriesType: 'histogram',
      color: '#10b981', // green
    };

    return [series];
  }
};
