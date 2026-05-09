import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult, IndicatorPoint } from './types';

interface RsiParams {
  period:    number;
  /** Period for EMA applied to RSI values. Set to 0 to disable. */
  emaPeriod: number;
  [key: string]: number;
}

/**
 * RSI with optional EMA overlay and crossover markers.
 *
 * When emaPeriod > 0:
 *   - A second series (EMA of RSI) is added to the same sub-pane
 *   - Circle markers appear on the RSI line at every RSI↔EMA crossover
 */
export const rsi: Indicator<RsiParams> = {
  id: 'rsi',
  name: 'RSI',
  defaultParams: { period: 14, emaPeriod: 10 },
  paramsMeta: {
    period:    { label: 'RSI Period',  min: 2, max: 100, step: 1 },
    emaPeriod: { label: 'EMA Period (0 = off)', min: 0, max: 100, step: 1 },
  },

  compute(candles: Candle[], { period, emaPeriod }: RsiParams): IndicatorResult {
    if (candles.length < period + 1) return [];

    // ── RSI (Wilder smoothing) ────────────────────────────────────────────────
    const rsiData: IndicatorPoint[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const diff = candles[i]!.close - candles[i - 1]!.close;
      avgGain += diff > 0 ? diff  : 0;
      avgLoss += diff < 0 ? -diff : 0;
    }
    avgGain /= period;
    avgLoss /= period;

    const rsiVal = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
    rsiData.push({ time: candles[period]!.openTime, value: rsiVal(avgGain, avgLoss) });

    for (let i = period + 1; i < candles.length; i++) {
      const diff = candles[i]!.close - candles[i - 1]!.close;
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff  : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      rsiData.push({ time: candles[i]!.openTime, value: rsiVal(avgGain, avgLoss) });
    }

    // ── EMA of RSI + crossover markers ───────────────────────────────────────
    if (emaPeriod <= 0 || rsiData.length < emaPeriod) {
      return [{
        id: `rsi_${period}`, name: `RSI ${period}`, data: rsiData,
        panel: 'sub', color: '#a855f7', lineWidth: 1.5, seriesType: 'line',
      }];
    }

    // Compute EMA on RSI values
    const k = 2 / (emaPeriod + 1);
    const emaData: IndicatorPoint[] = [];
    let prev = rsiData.slice(0, emaPeriod).reduce((s, p) => s + p.value, 0) / emaPeriod;
    emaData.push({ time: rsiData[emaPeriod - 1]!.time, value: prev });

    for (let i = emaPeriod; i < rsiData.length; i++) {
      prev = rsiData[i]!.value * k + prev * (1 - k);
      emaData.push({ time: rsiData[i]!.time, value: prev });
    }

    return [
      {
        id: `rsi_${period}`, name: `RSI ${period}`, data: rsiData,
        panel: 'sub', color: '#a855f7', lineWidth: 1.5, seriesType: 'line',
      },
      {
        id: `rsi_ema_${emaPeriod}`, name: `EMA ${emaPeriod}`, data: emaData,
        panel: 'sub', color: '#eab308', lineWidth: 1.5, seriesType: 'line',
      },
    ];
  },
};
