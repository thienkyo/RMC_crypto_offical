/**
 * CVD Divergence indicator.
 *
 * Detects divergences between price direction and Cumulative Volume Delta (CVD)
 * direction over a rolling lookback window.  Divergence = price and CVD moving
 * in OPPOSITE directions.
 *
 * BULLISH DIVERGENCE (hidden buying pressure):
 *   Price makes a LOWER low over the window  AND
 *   CVD makes a HIGHER low over the window.
 *   → Sellers couldn't push CVD lower despite price falling — buyers absorbing.
 *   → Reversal upward likely.
 *
 * BEARISH DIVERGENCE (hidden selling pressure):
 *   Price makes a HIGHER high over the window  AND
 *   CVD makes a LOWER high over the window.
 *   → Buyers couldn't push CVD higher despite price rising — sellers distributing.
 *   → Reversal downward likely.
 *
 * DETECTION APPROACH:
 *   For each bar i, we look back `lookback` bars:
 *     priceDelta = close[i] − close[i − lookback]
 *     cvdDelta   = cvd[i]   − cvd[i − lookback]
 *   Bullish div: priceDelta < 0 AND cvdDelta > 0 AND |cvdDelta| >= minCvdDeltaPct × cvd[i]
 *   Bearish div: priceDelta > 0 AND cvdDelta < 0 AND |cvdDelta| >= minCvdDeltaPct × cvd[i]
 *
 * Parameters:
 *   lookback         — window for divergence detection (default 14 bars).
 *   smoothing        — CVD EMA smoothing before divergence check (default 5).
 *   minPricePct      — minimum price move required to avoid noise (default 0.5%).
 *   minCvdChangePct  — minimum |cvdDelta| / max(|cvd|, 1) × 100 to confirm signal (default 5%).
 *
 * Output series (seriesIndex for strategy conditions):
 *   [0] bullish_divergence — 1 when bullish CVD divergence detected, else 0
 *   [1] bearish_divergence — 1 when bearish CVD divergence detected, else 0
 *   [2] cvd_line           — smoothed CVD value (for visual reference on chart)
 */

import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from './types';
import type { Candle } from '@/types/market';
import { approximateDelta } from '@/lib/exchange/deltaApprox';

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

export const cvd_divergence: Indicator = {
  id:   'cvd_divergence',
  name: 'CVD Divergence',
  description:
    'CVD Divergence detector. Fires when price direction and cumulative volume delta ' +
    'direction disagree — a sign of hidden buying (bullish div) or selling (bearish div) pressure.',
  defaultParams: { lookback: 14, smoothing: 5, minPricePct: 0.5, minCvdChangePct: 5 },
  paramsMeta: {
    lookback:        { label: 'Lookback bars',     min: 3,   max: 100, step: 1   },
    smoothing:       { label: 'CVD smoothing',     min: 1,   max: 50,  step: 1   },
    minPricePct:     { label: 'Min price move %',  min: 0,   max: 10,  step: 0.1 },
    minCvdChangePct: { label: 'Min CVD change %',  min: 0,   max: 50,  step: 1   },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const lookback        = Math.max(2,  Math.round(params['lookback']        ?? 14));
    const smoothing       = Math.max(1,  Math.round(params['smoothing']       ?? 5));
    const minPricePct     = params['minPricePct']     ?? 0.5;
    const minCvdChangePct = params['minCvdChangePct'] ?? 5;

    // Build per-bar deltas, then compute rolling CVD (sum of last `lookback` bars).
    // Cumulative-from-inception grows into billions of USDT making thresholds useless.
    const perBarDelta: number[] = [];
    for (const c of candles as CandleWithDelta[]) {
      let buyVol: number, sellVol: number;
      if (c.buyVolume != null && c.sellVolume != null) {
        buyVol = c.buyVolume; sellVol = c.sellVolume;
      } else {
        const approx = approximateDelta(c);
        buyVol = approx.buyVolume; sellVol = approx.sellVolume;
      }
      perBarDelta.push(buyVol - sellVol);
    }

    const rollingCVD: number[] = perBarDelta.map((_, i) => {
      const start = Math.max(0, i - lookback + 1);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += perBarDelta[j]!;
      return sum;
    });

    const smoothedCVD = computeEMA(rollingCVD, smoothing);

    const bullishData: { time: number; value: number }[] = [];
    const bearishData: { time: number; value: number }[] = [];
    const cvdData:     { time: number; value: number }[] = [];
    const bullMarkers: IndicatorMarker[] = [];
    const bearMarkers: IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c    = candles[i]!;
      const cvdV = smoothedCVD[i]!;

      cvdData.push({ time: c.openTime, value: cvdV });

      if (i < lookback) {
        bullishData.push({ time: c.openTime, value: 0 });
        bearishData.push({ time: c.openTime, value: 0 });
        continue;
      }

      const prevClose = candles[i - lookback]!.close;
      const prevCVD   = smoothedCVD[i - lookback]!;
      const maxAbsCVD = Math.max(Math.abs(cvdV), Math.abs(prevCVD), 1);

      const priceDelta   = c.close - prevClose;
      const cvdDelta     = cvdV   - prevCVD;
      const pricePct     = prevClose > 0 ? Math.abs(priceDelta / prevClose) * 100 : 0;
      const cvdChangePct = (Math.abs(cvdDelta) / maxAbsCVD) * 100;

      const minPriceMet = pricePct  >= minPricePct;
      const minCvdMet   = cvdChangePct >= minCvdChangePct;

      // Bullish divergence: price lower, CVD higher
      const isBullDiv = priceDelta < 0 && cvdDelta > 0 && minPriceMet && minCvdMet;
      // Bearish divergence: price higher, CVD lower
      const isBearDiv = priceDelta > 0 && cvdDelta < 0 && minPriceMet && minCvdMet;

      bullishData.push({ time: c.openTime, value: isBullDiv ? 1 : 0 });
      bearishData.push({ time: c.openTime, value: isBearDiv ? 1 : 0 });

      if (isBullDiv) {
        bullMarkers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#10b981',
          shape:    'arrowUp',
          size:     2,
          text:     'Bull Div',
        });
      }
      if (isBearDiv) {
        bearMarkers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     2,
          text:     'Bear Div',
        });
      }
    }

    /** Compact K / M formatter for large volume-scaled CVD values. */
    const fmtCVD = (v: number): string => {
      const sign = v < 0 ? '−' : '+';
      const abs  = Math.abs(v);
      if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + 'M';
      if (abs >= 1_000)     return sign + (abs / 1_000).toFixed(1)     + 'K';
      return (v >= 0 ? '+' : '−') + abs.toFixed(0);
    };

    /** Binary 0/1 formatter — shows "Active" or "—" instead of "+0.0000". */
    const fmtBinary = (v: number): string => (v >= 0.5 ? 'Active' : '—');

    const bullSeries: IndicatorSeries = {
      id:          'cvd_div_bull',
      name:        '▲ Bull Div',
      data:        bullishData,
      panel:       'sub',
      seriesType:  'histogram',
      color:       '#10b981',
      markers:     bullMarkers,
      formatValue: fmtBinary,
      // Independent scale so 0/1 bars are not dwarfed by the CVD line magnitude.
      priceScaleId: 'cvd_div_signals',
    };

    const bearSeries: IndicatorSeries = {
      id:          'cvd_div_bear',
      name:        '▼ Bear Div',
      data:        bearishData,
      panel:       'sub',
      seriesType:  'histogram',
      color:       '#ef4444',
      markers:     bearMarkers,
      formatValue: fmtBinary,
      priceScaleId: 'cvd_div_signals',
    };

    const cvdLineSeries: IndicatorSeries = {
      id:          'cvd_div_cvd_line',
      name:        `CVD(${smoothing})`,
      data:        cvdData,
      panel:       'sub',
      seriesType:  'line',
      color:       '#60a5fa',
      lineWidth:   1,
      formatValue: fmtCVD,
      volumeAxis:  true,
      // Separate right-axis scale — CVD lives in the billions, signals in 0/1.
      priceScaleId: 'cvd_div_cvd',
    };

    return [bullSeries, bearSeries, cvdLineSeries];
  },
};
