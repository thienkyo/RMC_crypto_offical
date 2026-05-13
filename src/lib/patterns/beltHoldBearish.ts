import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isRed, upperWick, isLongBody, getAvgBodySize, bodySize } from './utils';

export const beltHoldBearish: Indicator = {
  id: 'belt_hold_bearish',
  name: 'Belt-Hold Bearish',
  description: 'A bearish reversal pattern: A long red candle that opens at the period\'s high (no/tiny upper wick) and closes near its low after an uptrend.',
  bias: 'bearish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const avgBody = getAvgBodySize(candles, i, 10);

      // Condition:
      // 1. Red candle
      // 2. Long body
      // 3. Very small upper wick (ideally 0, but allow tiny wiggle room)
      const isBeltHold = isRed(c) && 
                         isLongBody(c, avgBody) && 
                         upperWick(c) <= bodySize(c) * 0.05;

      const value = isBeltHold ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     'BH',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'belt_hold_bearish_signal',
      name:       'Belt-Hold Bearish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
