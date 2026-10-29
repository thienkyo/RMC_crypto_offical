import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';
import { computeBollingerStats } from './math';

interface BbPctParams { period: number; stdDevMult: number; [key: string]: number }

/**
 * Bollinger Bands %B  (BB Index / %B)
 *
 * Formula:  %B = (Close − Lower Band) / (Upper Band − Lower Band)
 *
 * Interpretation:
 *   1.0  → price is at the Upper Band
 *   0.5  → price is at the Middle Band (SMA)
 *   0.0  → price is at the Lower Band
 *  >1.0  → price is above the Upper Band (overbought signal)
 *  <0.0  → price is below the Lower Band (oversold signal)
 *
 * Shares the same params as Bollinger Bands so they stay in sync.
 */
export const bbpct: Indicator<BbPctParams> = {
  id: 'bbpct',
  name: 'BB %B',
  description: 'Bollinger Bands %B. Quantifies a security\'s price relative to its Bollinger Bands. > 1 means price is above upper band, < 0 means below lower band.',
  defaultParams: { period: 20, stdDevMult: 2 },
  paramsMeta: {
    period:     { label: 'Period',      min: 2, max: 200, step: 1   },
    stdDevMult: { label: 'Std Dev (σ)', min: 1, max: 5,   step: 0.5 },
  },

  compute(candles: Candle[], { period, stdDevMult }: BbPctParams): IndicatorResult {
    if (candles.length < period) return [];

    const stats = computeBollingerStats(candles, period, stdDevMult);
    const data: { time: number; value: number }[] = stats.map((s) => {
      const range = s.upper - s.lower;
      // Avoid division by zero when all closes in the window are identical
      const pctB = range > 0 ? (s.close - s.lower) / range : 0.5;
      return { time: s.time, value: pctB };
    });

    return [
      {
        id:          'bbpct',
        name:        'BB %B',
        data,
        panel:       'sub',
        color:       '#06b6d4', // cyan — same family as BB band lines
        lineWidth:   1.5,
        seriesType:  'line',
      },
    ];
  },
};
