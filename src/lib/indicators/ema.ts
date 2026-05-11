import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface EmaParams { period: number; [key: string]: number }

export const ema: Indicator<EmaParams> = {
  id: 'ema',
  name: 'EMA',
  description: 'Exponential Moving Average. Reacts faster to recent price changes than SMA. Used to identify trend direction and dynamic support/resistance.',
  defaultParams: { period: 20 },
  paramsMeta: {
    period: { label: 'Period', min: 2, max: 500, step: 1 },
  },

  compute(candles: Candle[], { period }: EmaParams): IndicatorResult {
    if (candles.length < period) return [];

    const k    = 2 / (period + 1);
    const data: { time: number; value: number }[] = [];

    let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
    data.push({ time: candles[period - 1]!.openTime, value: prev });

    for (let i = period; i < candles.length; i++) {
      prev = candles[i]!.close * k + prev * (1 - k);
      data.push({ time: candles[i]!.openTime, value: prev });
    }

    return [{
      id: `ema_${period}`, name: `EMA ${period}`, data,
      panel: 'overlay', color: '#3b82f6', lineWidth: 1.5, seriesType: 'line',
    }];
  },
};
