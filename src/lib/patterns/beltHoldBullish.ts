import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, lowerWick, isLongBody, getAvgBodySize, bodySize } from './utils';

export const beltHoldBullish: Indicator = {
  id: 'belt_hold_bullish',
  name: 'Belt-Hold Bullish',
  description: 'A bullish reversal pattern: A long green candle that opens at the period\'s low (no/tiny lower wick) and closes near its high after a downtrend.',
  bias: 'bullish',
  defaultParams: {},
  paramsMeta: {},
  compute(candles: Candle[], _params: Record<string, number>): IndicatorResult {
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const avgBody = getAvgBodySize(candles, i, 10);

      // Condition:
      // 1. Green candle
      // 2. Long body
      // 3. Very small lower wick
      const isBeltHold = isGreen(c) && 
                         isLongBody(c, avgBody) && 
                         lowerWick(c) <= bodySize(c) * 0.05;

      const value = isBeltHold ? 1 : 0;
      data.push({ time: c.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#10b981',
          shape:    'arrowUp',
          size:     1,
          text:     'BH',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'belt_hold_bullish_signal',
      name:       'Belt-Hold Bullish',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#10b981',
      markers,
    };

    return [series];
  },
};
