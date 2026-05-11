import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface BollingerParams { period: number; stdDevMult: number; [key: string]: number }

export const bollinger: Indicator<BollingerParams> = {
  id: 'bollinger',
  name: 'Bollinger Bands',
  description: 'Bollinger Bands. Volatility indicator consisting of a middle SMA and upper/lower standard deviation bands. Helps identify overextended conditions.',
  defaultParams: { period: 20, stdDevMult: 2 },
  paramsMeta: {
    period:     { label: 'Period',      min: 2, max: 200, step: 1   },
    stdDevMult: { label: 'Std Dev (σ)', min: 1, max: 5,   step: 0.5 },
  },

  compute(candles: Candle[], { period, stdDevMult }: BollingerParams): IndicatorResult {
    if (candles.length < period) return [];

    const middle: { time: number; value: number }[] = [];
    const upper:  { time: number; value: number }[] = [];
    const lower:  { time: number; value: number }[] = [];

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
      const t      = candles[i]!.openTime;

      middle.push({ time: t, value: mean });
      upper.push({  time: t, value: mean + stdDevMult * stdDev });
      lower.push({  time: t, value: mean - stdDevMult * stdDev });
    }

    return [
      { id: 'bb_middle', name: 'BB Mid',   data: middle, panel: 'overlay', color: '#e2e8f0', lineWidth: 1,   seriesType: 'line' },
      { id: 'bb_upper',  name: 'BB Upper', data: upper,  panel: 'overlay', color: '#06b6d4', lineWidth: 1,   seriesType: 'line' },
      { id: 'bb_lower',  name: 'BB Lower', data: lower,  panel: 'overlay', color: '#06b6d4', lineWidth: 1,   seriesType: 'line' },
    ];
  },
};
