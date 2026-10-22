import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, bodySize, upperWick } from './utils';

export const advanceBlock: Indicator = {
  id: 'advance_block',
  name: 'Advance Block',
  description: 'A 3-candle bearish reversal within the lookback window (default 3 of 5 candles): three green candles with progressively shorter bodies and progressively longer upper wicks.',
  bias: 'bearish',
  defaultParams: { window: 5 },
  paramsMeta: {
    window: { label: 'Window (3 of N)', min: 3, max: 10, step: 1 },
  },
  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const windowSize = Math.max(3, Math.min(15, Math.round(params['window'] ?? 5)));
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    function isValidTriplet(c1: Candle, c2: Candle, c3: Candle): boolean {
      if (!isGreen(c1) || !isGreen(c2) || !isGreen(c3)) return false;

      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);

      if (!(b3 < b2 && b2 < b1)) return false;

      const u1 = upperWick(c1);
      const u2 = upperWick(c2);
      const u3 = upperWick(c3);

      if (!(u3 > u2 && u2 > u1)) return false;

      const opensInC1 = c2.open > c1.open && c2.open <= c1.close * 1.01;
      const opensInC2 = c3.open > c2.open && c3.open <= c2.close * 1.01;

      return opensInC1 && opensInC2;
    }

    for (let i = 0; i < candles.length; i++) {
      const c3 = candles[i]!;

      if (i < 2) {
        data.push({ time: c3.openTime, value: 0 });
        continue;
      }

      const startIdx = Math.max(0, i - windowSize + 1);
      let matched = false;

      if (isGreen(c3)) {
        for (let idx1 = startIdx; idx1 <= i - 2 && !matched; idx1++) {
          for (let idx2 = idx1 + 1; idx2 <= i - 1 && !matched; idx2++) {
            if (isValidTriplet(candles[idx1]!, candles[idx2]!, c3)) {
              matched = true;
            }
          }
        }
      }

      const value = matched ? 1 : 0;
      data.push({ time: c3.openTime, value });

      if (value === 1) {
        markers.push({
          time:     c3.openTime,
          position: 'aboveBar',
          color:    '#f59e0b',  // amber — weakening bulls, not a full reversal signal
          shape:    'arrowDown',
          size:     1,
          text:     'AdvB',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'advance_block_signal',
      name:       'Advance Block',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
