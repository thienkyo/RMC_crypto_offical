/**
 * Volume Profile indicator — OHLCV approximation.
 *
 * Volume Profile shows how much volume was traded at each price level over a
 * lookback window.  True Volume Profile requires tick/trade data, but a
 * high-quality approximation can be built from OHLCV by distributing each
 * candle's volume uniformly across its high–low range.
 *
 * KEY CONCEPTS:
 *   POC  — Point of Control: the price level (bin midpoint) with the most volume.
 *   Value Area (VA): the range of bins that together contain 70% of total volume.
 *   VAH  — Value Area High: upper boundary of the value area.
 *   VAL  — Value Area Low:  lower boundary of the value area.
 *
 * STRATEGY USE-CASE:
 *   Price inside the Value Area → rotational / mean-reversion trades.
 *   Price at VAH/VAL → fade / bounce plays.
 *   Price breaking outside VA → trend continuation trades.
 *
 * Parameters:
 *   lookback      — Number of bars over which to compute the profile (default 200).
 *                   The profile slides: each bar is computed using the last N bars.
 *   bins          — Number of price buckets dividing the high–low range (default 50).
 *   valueAreaPct  — Percentage of total volume that defines the Value Area (default 70).
 *
 * Output series (seriesIndex for strategy conditions):
 *   [0] vah             — Value Area High (price; overlay)
 *   [1] poc             — Point of Control (price; overlay)
 *   [2] val             — Value Area Low  (price; overlay)
 *   [3] dist_from_vah_pct — (close − VAH) / close × 100  (positive = above VAH)
 *   [4] dist_from_poc_pct — (close − POC) / close × 100
 *   [5] dist_from_val_pct — (close − VAL) / close × 100  (positive = above VAL)
 *
 * Series [3–5] are the key series for strategy conditions because they are unit-
 * agnostic percentage values that work with the existing gte / lte operators,
 * unlike the raw price series [0–2] which change with each asset's price.
 *
 * Example conditions:
 *   dist_from_poc_pct > 2   → price is ≥ 2% above POC (potential short)
 *   dist_from_val_pct < 0.5 → price is within 0.5% of VAL (potential long bounce)
 */

import type { Indicator, IndicatorResult, IndicatorSeries } from './types';
import type { Candle } from '@/types/market';

export const volume_profile: Indicator = {
  id:   'volume_profile',
  name: 'Volume Profile',
  description:
    'Rolling Volume Profile (OHLCV approximation). Outputs VAH, POC, and VAL ' +
    'as price-level overlays plus distance-from-level percentage series suitable ' +
    'for strategy conditions.',
  defaultParams: { lookback: 200, bins: 50, valueAreaPct: 70 },
  paramsMeta: {
    lookback:     { label: 'Lookback bars', min: 20,  max: 1000, step: 10  },
    bins:         { label: 'Price bins',    min: 10,  max: 200,  step: 5   },
    valueAreaPct: { label: 'Value area %',  min: 50,  max: 95,   step: 1   },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const lookback     = Math.max(2,  Math.round(params['lookback']     ?? 200));
    const bins         = Math.max(2,  Math.round(params['bins']         ?? 50));
    const valueAreaPct = Math.min(99, Math.max(1, params['valueAreaPct'] ?? 70));

    const vahData:    { time: number; value: number }[] = [];
    const pocData:    { time: number; value: number }[] = [];
    const valData:    { time: number; value: number }[] = [];
    const dvahData:   { time: number; value: number }[] = [];
    const dpocData:   { time: number; value: number }[] = [];
    const dvalData:   { time: number; value: number }[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 1) {
        // Not enough data — emit NaN-equivalent zeros
        vahData.push ({ time: c.openTime, value: 0 });
        pocData.push ({ time: c.openTime, value: 0 });
        valData.push ({ time: c.openTime, value: 0 });
        dvahData.push({ time: c.openTime, value: 0 });
        dpocData.push({ time: c.openTime, value: 0 });
        dvalData.push({ time: c.openTime, value: 0 });
        continue;
      }

      const start = Math.max(0, i - lookback + 1);
      const window = candles.slice(start, i + 1);

      // Find global high/low of the window
      let rangeHigh = -Infinity;
      let rangeLow  =  Infinity;
      for (const wc of window) {
        if (wc.high > rangeHigh) rangeHigh = wc.high;
        if (wc.low  < rangeLow)  rangeLow  = wc.low;
      }

      if (rangeHigh <= rangeLow) {
        // Degenerate (flat) — emit zeros
        vahData.push ({ time: c.openTime, value: 0 });
        pocData.push ({ time: c.openTime, value: 0 });
        valData.push ({ time: c.openTime, value: 0 });
        dvahData.push({ time: c.openTime, value: 0 });
        dpocData.push({ time: c.openTime, value: 0 });
        dvalData.push({ time: c.openTime, value: 0 });
        continue;
      }

      const binSize = (rangeHigh - rangeLow) / bins;

      // Volume distribution array — one slot per bin
      const volBins = new Float64Array(bins);

      for (const wc of window) {
        // Number of bins this candle spans
        const startBin = Math.floor((wc.low  - rangeLow) / binSize);
        const endBin   = Math.floor((wc.high - rangeLow) / binSize);
        const clampedStart = Math.max(0, Math.min(bins - 1, startBin));
        const clampedEnd   = Math.max(0, Math.min(bins - 1, endBin));
        const spannedBins  = clampedEnd - clampedStart + 1;
        const volPerBin    = wc.volume / spannedBins;

        for (let b = clampedStart; b <= clampedEnd; b++) {
          volBins[b]! += volPerBin;
        }
      }

      // POC — bin with highest volume
      let pocBin = 0;
      let maxVol = 0;
      for (let b = 0; b < bins; b++) {
        if (volBins[b]! > maxVol) { maxVol = volBins[b]!; pocBin = b; }
      }

      // Value Area — expand outward from POC until 70% of volume is covered
      const totalVol  = volBins.reduce((sum, v) => sum + v, 0);
      const vaTarget  = totalVol * (valueAreaPct / 100);
      let   vaVol     = volBins[pocBin]!;
      let   vaLow     = pocBin;
      let   vaHigh    = pocBin;

      while (vaVol < vaTarget && (vaLow > 0 || vaHigh < bins - 1)) {
        const addAbove = vaHigh < bins - 1 ? volBins[vaHigh + 1]! : 0;
        const addBelow = vaLow  > 0        ? volBins[vaLow  - 1]! : 0;

        if (addAbove >= addBelow) {
          vaHigh++;
          vaVol += addAbove;
        } else {
          vaLow--;
          vaVol += addBelow;
        }
      }

      // Convert bin indices → price levels (midpoint of each bin)
      const pocPrice = rangeLow + (pocBin + 0.5) * binSize;
      const vahPrice = rangeLow + (vaHigh + 1)   * binSize;   // top edge of highest VA bin
      const valPrice = rangeLow + vaLow           * binSize;   // bottom edge of lowest VA bin

      const close = c.close;

      vahData.push ({ time: c.openTime, value: vahPrice });
      pocData.push ({ time: c.openTime, value: pocPrice });
      valData.push ({ time: c.openTime, value: valPrice });
      dvahData.push({ time: c.openTime, value: close > 0 ? ((close - vahPrice) / close) * 100 : 0 });
      dpocData.push({ time: c.openTime, value: close > 0 ? ((close - pocPrice) / close) * 100 : 0 });
      dvalData.push({ time: c.openTime, value: close > 0 ? ((close - valPrice) / close) * 100 : 0 });
    }

    const vahSeries: IndicatorSeries = {
      id:         'vp_vah',
      name:       'VAH',
      data:       vahData,
      panel:      'overlay',
      seriesType: 'line',
      color:      '#f59e0b',
      lineWidth:  1,
    };

    const pocSeries: IndicatorSeries = {
      id:         'vp_poc',
      name:       'POC',
      data:       pocData,
      panel:      'overlay',
      seriesType: 'line',
      color:      '#f97316',
      lineWidth:  2,
    };

    const valSeries: IndicatorSeries = {
      id:         'vp_val',
      name:       'VAL',
      data:       valData,
      panel:      'overlay',
      seriesType: 'line',
      color:      '#f59e0b',
      lineWidth:  1,
    };

    const dvahSeries: IndicatorSeries = {
      id:         'vp_dist_vah_pct',
      name:       'Dist from VAH %',
      data:       dvahData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#fbbf24',
    };

    const dpocSeries: IndicatorSeries = {
      id:         'vp_dist_poc_pct',
      name:       'Dist from POC %',
      data:       dpocData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#fb923c',
    };

    const dvalSeries: IndicatorSeries = {
      id:         'vp_dist_val_pct',
      name:       'Dist from VAL %',
      data:       dvalData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#fbbf24',
    };

    return [vahSeries, pocSeries, valSeries, dvahSeries, dpocSeries, dvalSeries];
  },
};
