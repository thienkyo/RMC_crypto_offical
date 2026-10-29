/**
 * Stochastic RSI
 *
 * Applies the Stochastic formula to RSI values instead of raw price.
 * More sensitive than standard RSI — useful for timing entries within a trend.
 *
 *   rawK[i] = (RSI[i] − minRSI(N)) / (maxRSI(N) − minRSI(N)) × 100
 *   %K = SMA(rawK, kSmooth)   — fast line
 *   %D = SMA(%K,  dSmooth)    — slow signal line
 *
 * Outputs two series:
 *   [0] %K  — fast, more reactive
 *   [1] %D  — slow signal, crossovers with %K are entry triggers
 *
 * Thresholds:
 *   > 80  → overbought (potential short entry)
 *   < 20  → oversold   (potential long entry)
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';
import { computeWilderRsiValues, smaArray } from './math';

interface StochRsiParams {
  rsiPeriod:   number;
  stochPeriod: number;
  kSmooth:     number;
  dSmooth:     number;
  [key: string]: number;
}

export const stochrsi: Indicator<StochRsiParams> = {
  id:   'stochrsi',
  name: 'Stochastic RSI',
  description:
    'Stochastic RSI. Applies the Stochastic formula to RSI values, producing a more ' +
    'sensitive oscillator. %K > 80 = overbought (short signal); %K < 20 = oversold (long signal). ' +
    'Series: [0] %K (fast), [1] %D (slow signal).',
  defaultParams: { rsiPeriod: 14, stochPeriod: 14, kSmooth: 3, dSmooth: 3 },
  paramsMeta: {
    rsiPeriod:   { label: 'RSI Period',        min: 2, max: 100, step: 1 },
    stochPeriod: { label: 'Stoch Period',       min: 2, max: 100, step: 1 },
    kSmooth:     { label: '%K Smooth (SMA)',    min: 1, max: 20,  step: 1 },
    dSmooth:     { label: '%D Smooth (SMA)',    min: 1, max: 20,  step: 1 },
  },

  compute(
    candles: Candle[],
    { rsiPeriod, stochPeriod, kSmooth, dSmooth }: StochRsiParams,
  ): IndicatorResult {
    const rp = Math.max(2, Math.round(rsiPeriod));
    const sp = Math.max(2, Math.round(stochPeriod));
    const ks = Math.max(1, Math.round(kSmooth));
    const ds = Math.max(1, Math.round(dSmooth));

    const rsiValues = computeWilderRsiValues(candles, rp);
    // rsiValues[j] aligns to candles[j + rp]

    if (rsiValues.length < sp) return [];

    // ── Stochastic of RSI ─────────────────────────────────────────────────────
    const rawK: number[] = [];
    for (let i = sp - 1; i < rsiValues.length; i++) {
      const window = rsiValues.slice(i - sp + 1, i + 1);
      const lo = Math.min(...window);
      const hi = Math.max(...window);
      rawK.push(hi === lo ? 50 : ((rsiValues[i]! - lo) / (hi - lo)) * 100);
    }
    // rawK[k] aligns to candles[k + rp + sp - 1]

    const smoothedK = smaArray(rawK, ks);
    const smoothedD = smaArray(smoothedK.filter((v) => !isNaN(v)), ds);

    // Align smoothedK/D back to candle timestamps
    const kOffset = rp + sp - 1; // candle index of rawK[0]
    const kStart  = ks - 1;      // first non-NaN in smoothedK

    const kData: { time: number; value: number }[] = [];
    const dData: { time: number; value: number }[] = [];

    let dIdx = 0;
    for (let i = kStart; i < smoothedK.length; i++) {
      const ci = kOffset + i;
      if (ci >= candles.length) break;
      const t = candles[ci]!.openTime;
      kData.push({ time: t, value: smoothedK[i]! });

      // %D: first ds-1 smoothedK values produce NaN, then a real value
      if (i - kStart >= ds - 1) {
        if (dIdx < smoothedD.length) {
          dData.push({ time: t, value: smoothedD[dIdx]! });
          dIdx++;
        }
      }
    }

    return [
      {
        id: `stochrsi_k_${rp}_${sp}`, name: `StochRSI %K`,
        data: kData, panel: 'sub',
        color: '#3b82f6', lineWidth: 1.5, seriesType: 'line',
      },
      {
        id: `stochrsi_d_${rp}_${sp}`, name: `StochRSI %D`,
        data: dData, panel: 'sub',
        color: '#f97316', lineWidth: 1, seriesType: 'line',
      },
    ];
  },
};
