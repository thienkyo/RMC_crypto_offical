import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface MacdParams { fast: number; slow: number; signal: number; [key: string]: number }

function emaArray(values: number[], period: number): number[] {
  const k   = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) out.push(NaN);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export const macd: Indicator<MacdParams> = {
  id: 'macd',
  name: 'MACD',
  defaultParams: { fast: 12, slow: 26, signal: 9 },
  paramsMeta: {
    fast:   { label: 'Fast Period',   min: 2,  max: 100, step: 1 },
    slow:   { label: 'Slow Period',   min: 2,  max: 200, step: 1 },
    signal: { label: 'Signal Period', min: 2,  max: 50,  step: 1 },
  },

  compute(candles: Candle[], { fast, slow, signal }: MacdParams): IndicatorResult {
    if (candles.length < slow + signal) return [];

    const closes   = candles.map((c) => c.close);
    const fastEma  = emaArray(closes, fast);
    const slowEma  = emaArray(closes, slow);
    const macdLine = fastEma.map((f, i) => f - slowEma[i]!);

    const macdValid  = macdLine.slice(slow - 1);
    const signalArr  = emaArray(macdValid, signal);
    const startIdx   = (slow - 1) + (signal - 1);

    if (startIdx >= candles.length) return [];

    const macdSlice   = macdValid.slice(signal - 1);
    const signalSlice = signalArr.slice(signal - 1);
    const histSlice   = macdSlice.map((m, i) => m - signalSlice[i]!);
    const times       = candles.slice(startIdx).map((c) => c.openTime);

    return [
      {
        id: 'macd_line', name: 'MACD',
        data: macdSlice.map((v, i) => ({ time: times[i]!, value: v })),
        panel: 'sub', color: '#3b82f6', lineWidth: 1.5, seriesType: 'line',
      },
      {
        id: 'macd_signal', name: 'Signal',
        data: signalSlice.map((v, i) => ({ time: times[i]!, value: v })),
        panel: 'sub', color: '#f59e0b', lineWidth: 1, seriesType: 'line',
      },
      {
        id: 'macd_hist', name: 'Histogram',
        data: histSlice.map((v, i) => ({
          time: times[i]!, value: v,
          color: v >= 0 ? '#10b981' : '#ef4444',
        })),
        panel: 'sub', color: '#10b981', lineWidth: 1, seriesType: 'histogram',
      },
    ];
  },
};
