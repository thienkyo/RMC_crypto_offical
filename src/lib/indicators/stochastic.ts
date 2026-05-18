/**
 * Stochastic Oscillator (Lane's Stochastic — price-based, not RSI-based).
 *
 * Distinct from Stochastic RSI (stochrsi.ts), which applies the Stochastic
 * formula to RSI values. This indicator applies it directly to price.
 *
 *   Raw %K[i] = (Close[i] − Lowest Low(N)) / (Highest High(N) − Lowest Low(N)) × 100
 *   %K = SMA(Raw%K, kSmooth)    — smoothed fast line (default kSmooth = 3)
 *   %D = SMA(%K, dPeriod)       — slow signal line
 *
 * Outputs two series:
 *   [0] %K — fast line
 *   [1] %D — slow signal line
 *
 * Thresholds:
 *   > 80  → overbought zone (potential reversal short)
 *   < 20  → oversold zone   (potential reversal long)
 *
 * Crossovers: %K crossing above %D in oversold zone = bullish entry signal.
 *             %K crossing below %D in overbought zone = bearish entry signal.
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface StochasticParams {
  period:  number; // look-back window for Highest High / Lowest Low
  kSmooth: number; // SMA smoothing applied to raw %K
  dPeriod: number; // SMA period for %D (signal line)
  [key: string]: number;
}

/** Simple SMA over a plain number array — returns same-length array (NaN during warm-up). */
function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i < period - 1) {
      out.push(NaN);
    } else {
      if (i >= period) sum -= values[i - period]!;
      out.push(sum / period);
    }
  }
  return out;
}

export const stochastic: Indicator<StochasticParams> = {
  id:   'stochastic',
  name: 'Stochastic',
  description:
    'Stochastic Oscillator (price-based). Compares a closing price to its High/Low range ' +
    'over N periods. %K > 80 = overbought; %K < 20 = oversold. ' +
    'Series: [0] %K (fast), [1] %D (slow signal). ' +
    'Distinct from Stochastic RSI — this uses raw price, not RSI values.',
  defaultParams: { period: 14, kSmooth: 3, dPeriod: 3 },
  paramsMeta: {
    period:  { label: 'Period',        min: 2, max: 100, step: 1 },
    kSmooth: { label: '%K Smooth',     min: 1, max: 10,  step: 1 },
    dPeriod: { label: '%D Period',     min: 1, max: 10,  step: 1 },
  },

  compute(
    candles: Candle[],
    { period, kSmooth, dPeriod }: StochasticParams,
  ): IndicatorResult {
    const p  = Math.max(2, Math.round(period));
    const ks = Math.max(1, Math.round(kSmooth));
    const dp = Math.max(1, Math.round(dPeriod));

    if (candles.length < p) return [];

    // ── Step 1: raw %K ────────────────────────────────────────────────────────
    const rawK: number[] = [];
    for (let i = p - 1; i < candles.length; i++) {
      let lo = candles[i]!.low;
      let hi = candles[i]!.high;
      for (let j = i - p + 1; j < i; j++) {
        if (candles[j]!.low  < lo) lo = candles[j]!.low;
        if (candles[j]!.high > hi) hi = candles[j]!.high;
      }
      const range = hi - lo;
      rawK.push(range > 0 ? ((candles[i]!.close - lo) / range) * 100 : 50);
    }
    // rawK[k] aligns to candles[k + p - 1]

    // ── Step 2: smooth %K ─────────────────────────────────────────────────────
    const smoothedK = sma(rawK, ks);

    // ── Step 3: %D = SMA of smoothed %K (skip NaN warm-up values) ────────────
    const validK = smoothedK.filter((v) => !Number.isNaN(v));
    const dValues = sma(validK, dp);

    // ── Step 4: align to candle timestamps ───────────────────────────────────
    const kOffset = p - 1;     // candle index of rawK[0]
    const kStart  = ks - 1;    // first non-NaN in smoothedK

    const kData: { time: number; value: number }[] = [];
    const dData: { time: number; value: number }[] = [];

    let dIdx = 0;
    for (let i = kStart; i < smoothedK.length; i++) {
      const ci = kOffset + i;
      if (ci >= candles.length) break;
      const t = candles[ci]!.openTime;
      kData.push({ time: t, value: smoothedK[i]! });

      if (i - kStart >= dp - 1) {
        if (dIdx < dValues.length) {
          dData.push({ time: t, value: dValues[dIdx]! });
          dIdx++;
        }
      }
    }

    return [
      {
        id:         'stoch_k',
        name:       'Stoch %K',
        data:       kData,
        panel:      'sub',
        color:      '#3b82f6', // blue
        lineWidth:  1.5,
        seriesType: 'line',
      },
      {
        id:         'stoch_d',
        name:       'Stoch %D',
        data:       dData,
        panel:      'sub',
        color:      '#f97316', // orange
        lineWidth:  1,
        seriesType: 'line',
      },
    ];
  },
};
