/**
 * Bollinger Bandwidth — measures the width of the Bollinger Bands relative to
 * the middle band (SMA). Used to identify volatility squeezes.
 *
 *   BB Width = (Upper Band − Lower Band) / Middle Band × 100
 *
 * Interpretation:
 *   Low value  → bands are narrow → "squeeze" → potential breakout brewing
 *   High value → bands are wide   → high volatility phase
 *
 * Strategy use: wait for BB Width to drop below a threshold (e.g. < 4.0 on 4h
 * BTC), then look for a momentum trigger (RSI, MACD) to time the breakout.
 *
 * Note: uses the same params as Bollinger Bands so they stay in sync.
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface BbWidthParams { period: number; stdDevMult: number; [key: string]: number }

export const bb_width: Indicator<BbWidthParams> = {
  id:   'bb_width',
  name: 'BB Width',
  description:
    'Bollinger Bandwidth. Measures how wide the Bollinger Bands are as a percentage ' +
    'of the middle SMA. Low values indicate a "squeeze" — low volatility period that ' +
    'often precedes a sharp breakout. Formula: (Upper − Lower) / Middle × 100.',
  defaultParams: { period: 20, stdDevMult: 2 },
  paramsMeta: {
    period:     { label: 'Period',      min: 2, max: 200, step: 1   },
    stdDevMult: { label: 'Std Dev (σ)', min: 1, max: 5,   step: 0.5 },
  },

  compute(candles: Candle[], { period, stdDevMult }: BbWidthParams): IndicatorResult {
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

      // Bandwidth as percentage of middle band — avoids asset-price dependency
      const width = mean > 0 ? ((upper - lower) / mean) * 100 : 0;

      data.push({ time: candles[i]!.openTime, value: width });
    }

    return [
      {
        id:         'bb_width',
        name:       'BB Width',
        data,
        panel:      'sub',
        color:      '#a78bfa', // violet — distinct from BB cyan
        lineWidth:  1.5,
        seriesType: 'line',
      },
    ];
  },
};
