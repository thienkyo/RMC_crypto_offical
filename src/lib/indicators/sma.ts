import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface SmaParams { period: number; [key: string]: number }

export const sma: Indicator<SmaParams> = {
  id: 'sma',
  name: 'SMA',
  description: 'Simple Moving Average. Shows the average price over a period. Useful for identifying the overall, smoother trend direction.',
  defaultParams: { period: 20 },
  paramsMeta: {
    period: { label: 'Period', min: 2, max: 500, step: 1 },
  },

  compute(candles: Candle[], { period }: SmaParams): IndicatorResult {
    if (candles.length < period) return [];

    const data: { time: number; value: number }[] = [];
    let sum = candles.slice(0, period).reduce((s, c) => s + c.close, 0);
    data.push({ time: candles[period - 1]!.openTime, value: sum / period });

    for (let i = period; i < candles.length; i++) {
      sum += candles[i]!.close - candles[i - period]!.close;
      data.push({ time: candles[i]!.openTime, value: sum / period });
    }

    return [{
      id: `sma_${period}`, name: `SMA ${period}`, data,
      panel: 'overlay', color: '#f59e0b', lineWidth: 1.5, seriesType: 'line',
    }];
  },
};
