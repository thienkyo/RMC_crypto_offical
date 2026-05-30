/**
 * Cumulative Volume Delta (CVD) indicator.
 *
 * CVD = running sum of (buyVolume − sellVolume) across all candles in the series.
 * It tells you whether buying or selling pressure has been dominant over time.
 *
 * READING CVD:
 *   CVD rising + price rising  → healthy trend (buying confirmed by flow)
 *   CVD rising + price falling → divergence — buyers stepping in, reversal possible
 *   CVD falling + price rising → divergence — sellers distributing into rally
 *   CVD falling + price falling → trend confirmed by selling pressure
 *
 * DATA SOURCES (priority order):
 *   1. candle.buyVolume / candle.sellVolume — real aggTrades data from DB (Phase B)
 *   2. OHLCV delta approximation (deltaApprox.ts) — fallback when aggTrades unavailable
 *
 * The indicator checks which source is available per-candle and uses the best
 * available data, allowing graceful degradation when aggTrades data is partial.
 *
 * Output series (seriesIndex for strategy conditions):
 *   [0] cvd          — raw cumulative delta value
 *   [1] cvd_ema      — smoothed CVD (EMA with period = smoothing param)
 *   [2] cvd_delta    — per-bar delta (not cumulative) — useful for histogram coloring
 *
 * Parameters:
 *   lookback  — rolling window length for the CVD sum (default 200 bars).
 *               CVD[i] = sum of per-bar deltas over the last `lookback` bars.
 *               Prevents the forever-growing absolute value that makes the scale unreadable.
 *   smoothing — EMA period for the smoothed CVD line (default 14).
 *
 * IMPORTANT: The CVD value is on the same scale as volume (quote asset units),
 * so it is NOT directly comparable between assets. Use it for trend and divergence
 * analysis, not absolute level comparisons.
 */

import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorPoint } from './types';
import type { Candle } from '@/types/market';
import { approximateDelta } from '@/lib/exchange/deltaApprox';

/** Extended candle shape including optional buy/sell split from aggTrades DB. */
interface CandleWithDelta extends Candle {
  buyVolume?:  number;
  sellVolume?: number;
}

function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0 || period < 1) return values;
  const k   = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0]!;
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}

export const cvd: Indicator = {
  id:   'cvd',
  name: 'CVD',
  description:
    'Cumulative Volume Delta. Tracks the running sum of buy volume minus sell volume. ' +
    'Divergences between CVD and price reveal hidden buying/selling pressure.',
  defaultParams: { lookback: 200, smoothing: 14 },
  paramsMeta: {
    lookback:  { label: 'Lookback bars',   min: 10, max: 1000, step: 10 },
    smoothing: { label: 'Smoothing (EMA)', min: 1,  max: 100,  step: 1  },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const lookback  = Math.max(1, Math.round(params['lookback']  ?? 200));
    const smoothing = Math.max(1, Math.round(params['smoothing'] ?? 14));

    const perBarDelta: number[] = [];
    const times:       number[] = [];

    for (const c of candles as CandleWithDelta[]) {
      let buyVol:  number;
      let sellVol: number;

      if (c.buyVolume != null && c.sellVolume != null) {
        buyVol  = c.buyVolume;
        sellVol = c.sellVolume;
      } else {
        const approx = approximateDelta(c);
        buyVol  = approx.buyVolume;
        sellVol = approx.sellVolume;
      }

      perBarDelta.push(buyVol - sellVol);
      times.push(c.openTime);
    }

    // Rolling CVD: sum of the last `lookback` bar deltas.
    // A forever-growing cumulative sum of USDT quote volume hits billions after ~200 bars
    // and makes the chart scale unreadable. Rolling window keeps values proportional to
    // recent activity and resets context naturally as old bars drop off.
    const rollingCVD: number[] = perBarDelta.map((_, i) => {
      const start = Math.max(0, i - lookback + 1);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += perBarDelta[j]!;
      return sum;
    });

    const smoothedCVD = computeEMA(rollingCVD, smoothing);

    const cvdData:   IndicatorPoint[] = times.map((t, i) => ({ time: t, value: rollingCVD[i]!  }));
    const emaData:   IndicatorPoint[] = times.map((t, i) => ({ time: t, value: smoothedCVD[i]! }));
    const deltaData: IndicatorPoint[] = times.map((t, i) => ({
      time:  t,
      value: perBarDelta[i]!,
      color: perBarDelta[i]! >= 0 ? '#10b981' : '#ef4444',
    }));

    /** Compact K / M formatter for large volume-scaled values. */
    const fmtCVD = (v: number): string => {
      const sign = v < 0 ? '−' : '+';
      const abs  = Math.abs(v);
      if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + 'M';
      if (abs >= 1_000)     return sign + (abs / 1_000).toFixed(1)     + 'K';
      return (v >= 0 ? '+' : '−') + abs.toFixed(0);
    };

    const cvdSeries: IndicatorSeries = {
      id:          'cvd_line',
      name:        'CVD',
      data:        cvdData,
      panel:       'sub',
      seriesType:  'line',
      color:       '#60a5fa',
      lineWidth:   1,
      formatValue: fmtCVD,
      volumeAxis:  true,
    };

    const emaSeries: IndicatorSeries = {
      id:          'cvd_ema',
      name:        `CVD EMA(${smoothing})`,
      data:        emaData,
      panel:       'sub',
      seriesType:  'line',
      color:       '#f59e0b',
      lineWidth:   1,
      formatValue: fmtCVD,
      volumeAxis:  true,
    };

    const deltaSeries: IndicatorSeries = {
      id:          'cvd_delta_hist',
      name:        'Δ',
      data:        deltaData,
      panel:       'sub',
      seriesType:  'histogram',
      color:       '#10b981',
      formatValue: fmtCVD,
      volumeAxis:  true,
    };

    return [cvdSeries, emaSeries, deltaSeries];
  },
};
