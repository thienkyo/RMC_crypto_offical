import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';
import { emaArray } from './math';

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

    const emaValues = emaArray(candles.map((c) => c.close), period);
    const data: { time: number; value: number }[] = [];

    for (let i = period - 1; i < candles.length; i++) {
      data.push({ time: candles[i]!.openTime, value: emaValues[i]! });
    }

    return [{
      id: `ema_${period}`, name: `EMA ${period}`, data,
      panel: 'overlay', color: '#3b82f6', lineWidth: 1.5, seriesType: 'line',
    }];
  },
};
