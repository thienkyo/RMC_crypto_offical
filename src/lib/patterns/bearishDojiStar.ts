import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed, isDoji, isLongBody, getAvgBodySize } from './utils';

/**
 * Bearish Doji Star (Evening Doji Star with confirmation).
 *
 * 3-candle pattern — signal fires on the confirmation candle (c3):
 *   c1: long bullish candle
 *   c2: doji whose body gaps above c1's body top (body gap up)
 *   c3: bearish confirmation — red candle that closes below the midpoint of c1's body
 *
 * Requiring c3 before signalling eliminates the high false-positive rate of the
 * 2-candle variant (which fires on every doji after a bullish candle in a bull run).
 */
export const bearishDojiStar: Indicator = {
  id: 'bearish_doji_star',
  name: 'Bearish Doji Star',
  description: 'A 3-candle bearish reversal: long green candle → doji gapping above c1 body → bearish confirmation closing below c1 midpoint.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      // Need at least 3 candles
      if (i < 2) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c1 = candles[i - 2]!;
      const c2 = candles[i - 1]!;
      const c3 = c;

      const avgBody = getAvgBodySize(candles, i - 2, 10);

      // c1: long bullish candle
      if (!isGreen(c1) || !isLongBody(c1, avgBody)) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // c2: doji whose body min is above c1's body top (body gap up)
      const c2BodyMin  = Math.min(c2.open, c2.close);
      const c1BodyMax  = c1.close; // isGreen(c1) guaranteed above
      if (!isDoji(c2) || c2BodyMin <= c1BodyMax) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      // c3: bearish confirmation — must be red and close below c1's midpoint
      const c1Midpoint = (c1.open + c1.close) / 2;
      if (!isRed(c3) || c3.close >= c1Midpoint) {
        data.push({ time: c.openTime, value: 0 });
        continue;
      }

      data.push({ time: c.openTime, value: 1 });
      markers.push({
        time:     c.openTime,
        position: 'aboveBar',
        color:    '#ef4444',
        shape:    'arrowDown',
        size:     1,
        text:     'DS↓',
      });
    }

    const series: IndicatorSeries = {
      id:         'bearish_doji_star_signal',
      name:       'Bearish Doji Star',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
