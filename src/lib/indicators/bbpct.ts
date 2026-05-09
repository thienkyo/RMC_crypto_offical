import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

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
  defaultParams: { period: 20, stdDevMult: 2 },
  paramsMeta: {
    period:     { label: 'Period',      min: 2, max: 200, step: 1   },
    stdDevMult: { label: 'Std Dev (σ)', min: 1, max: 5,   step: 0.5 },
  },

  compute(candles: Candle[], { period, stdDevMult }: BbPctParams): IndicatorResult {
    if (candles.length < period) return [];

    const data: { time: number; value: number }[] = [];
    let rollingSum = candles.slice(0, period).reduce((s, c) => s + c.close, 0);

    for (let i = period - 1; i < candles.length; i++) {
      if (i >= period) rollingSum += candles[i]!.close - candles[i - period]!.close;

      const mean = rollingSum / period;
      let sumSqDiff = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = candles[j]!.close - mean;
        sumSqDiff += d * d;
      }
      const stdDev = Math.sqrt(sumSqDiff / period);
      const upper  = mean + stdDevMult * stdDev;
      const lower  = mean - stdDevMult * stdDev;
      const range  = upper - lower;

      // Avoid division by zero when all closes in the window are identical
      const pctB = range > 0 ? (candles[i]!.close - lower) / range : 0.5;

      data.push({ time: candles[i]!.openTime, value: pctB });
    }

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
