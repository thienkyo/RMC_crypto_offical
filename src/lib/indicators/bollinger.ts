import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';
import { computeBollingerStats } from './math';

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

    const stats = computeBollingerStats(candles, period, stdDevMult);
    const middle: { time: number; value: number }[] = [];
    const upper:  { time: number; value: number }[] = [];
    const lower:  { time: number; value: number }[] = [];

    for (const s of stats) {
      middle.push({ time: s.time, value: s.mean });
      upper.push({  time: s.time, value: s.upper });
      lower.push({  time: s.time, value: s.lower });
    }

    return [
      { id: 'bb_middle', name: 'BB Mid',   data: middle, panel: 'overlay', color: '#e2e8f0', lineWidth: 1,   seriesType: 'line' },
      { id: 'bb_upper',  name: 'BB Upper', data: upper,  panel: 'overlay', color: '#06b6d4', lineWidth: 1,   seriesType: 'line' },
      { id: 'bb_lower',  name: 'BB Lower', data: lower,  panel: 'overlay', color: '#06b6d4', lineWidth: 1,   seriesType: 'line' },
    ];
  },
};
