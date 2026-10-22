import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isRed, bodySize } from './utils';

export const identicalThreeCrows: Indicator = {
  id: 'identical_three_crows',
  name: 'Identical Three Crows',
  description: 'A 3-candle bearish pattern within the lookback window (default 3 of 5 candles): Three red candles with similar sizes closing progressively lower. Allows 1–2 pause candles in between.',
  bias: 'bearish',
  defaultParams: { window: 5 },
  paramsMeta: {
    window: { label: 'Window (3 of N)', min: 3, max: 10, step: 1 },
  },
  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const windowSize = Math.max(3, Math.min(15, Math.round(params['window'] ?? 5)));
    const data: { time: number; value: number }[] = [];
    const markers: IndicatorMarker[] = [];

    function isValidTriplet(
      c1: Candle,
      c2: Candle,
      c3: Candle,
      consecutive12: boolean,
      consecutive23: boolean,
      windowSlice: Candle[],
    ): boolean {
      if (!isRed(c1) || !isRed(c2) || !isRed(c3)) return false;

      const b1 = bodySize(c1);
      const b2 = bodySize(c2);
      const b3 = bodySize(c3);

      const avgB = (b1 + b2 + b3) / 3;
      if (
        avgB === 0 ||
        Math.abs(b1 - avgB) > avgB * 0.3 ||
        Math.abs(b2 - avgB) > avgB * 0.3 ||
        Math.abs(b3 - avgB) > avgB * 0.3
      ) {
        return false;
      }

      if (!(c2.close < c1.close && c3.close < c2.close)) return false;

      const openNearClose2 = consecutive12
        ? Math.abs(c2.open - c1.close) <= b1 * 0.15
        : c2.open <= c1.open && c2.open >= c1.close * 0.99;
      const openNearClose3 = consecutive23
        ? Math.abs(c3.open - c2.close) <= b2 * 0.15
        : c3.open <= c2.open && c3.open >= c2.close * 0.99;

      if (!openNearClose2 || !openNearClose3) return false;

      for (const bar of windowSlice) {
        if (bar.close > c1.open) return false;
      }

      return true;
    }

    for (let i = 0; i < candles.length; i++) {
      const c3 = candles[i]!;

      if (i < 2) {
        data.push({ time: c3.openTime, value: 0 });
        continue;
      }

      const startIdx = Math.max(0, i - windowSize + 1);
      let matched = false;

      if (isRed(c3)) {
        for (let idx1 = startIdx; idx1 <= i - 2 && !matched; idx1++) {
          for (let idx2 = idx1 + 1; idx2 <= i - 1 && !matched; idx2++) {
            const c1 = candles[idx1]!;
            const c2 = candles[idx2]!;
            const slice = candles.slice(idx1, i + 1);
            if (isValidTriplet(c1, c2, c3, idx2 === idx1 + 1, i === idx2 + 1, slice)) {
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
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     '3C',
        });
      }
    }

    const series: IndicatorSeries = {
      id:         'identical_three_crows_signal',
      name:       'Identical Three Crows',
      data,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    return [series];
  },
};
