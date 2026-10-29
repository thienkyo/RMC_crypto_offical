import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult, IndicatorPoint } from './types';
import { computeWilderRsiValues, emaArray } from './math';

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
  description: 'Relative Strength Index. Momentum oscillator measuring the speed and change of price movements. > 70 implies overbought, < 30 implies oversold.',
  defaultParams: { period: 14, emaPeriod: 10 },
  paramsMeta: {
    period:    { label: 'RSI Period',  min: 2, max: 100, step: 1 },
    emaPeriod: { label: 'EMA Period (0 = off)', min: 0, max: 100, step: 1 },
  },

  compute(candles: Candle[], { period = 14, emaPeriod = 10 }: Partial<RsiParams> = {}): IndicatorResult {
    if (candles.length < period + 1) return [];

    // ── RSI (Wilder smoothing) ────────────────────────────────────────────────
    const rsiValues = computeWilderRsiValues(candles, period);
    const rsiData: IndicatorPoint[] = rsiValues.map((value, idx) => ({
      time: candles[period + idx]!.openTime,
      value,
    }));

    // ── EMA of RSI + crossover markers ───────────────────────────────────────
    if (!emaPeriod || emaPeriod <= 0 || rsiData.length < emaPeriod) {
      return [{
        id: `rsi_${period}`, name: `RSI ${period}`, data: rsiData,
        panel: 'sub', color: '#a855f7', lineWidth: 1.5, seriesType: 'line',
      }];
    }

    // Compute EMA on RSI values
    const emaValues = emaArray(rsiValues, emaPeriod);
    const emaData: IndicatorPoint[] = [];
    for (let i = emaPeriod - 1; i < rsiData.length; i++) {
      emaData.push({ time: rsiData[i]!.time, value: emaValues[i]! });
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
