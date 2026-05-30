/**
 * Fair Value Gap (FVG) — ICT concept.
 *
 * A three-candle formation where the wicks of candle[i-2] and candle[i] do not
 * overlap, leaving a "gap" that price is expected to revisit.
 *
 * BULLISH FVG  (demand imbalance):
 *   candle[i-2].high < candle[i].low
 *   ↳ Gap between top of first candle and bottom of third candle.
 *   ↳ Plotted at candle[i] (the candle that completes the gap).
 *   ↳ Signal value = gap size in price units (positive).
 *
 * BEARISH FVG  (supply imbalance):
 *   candle[i-2].low > candle[i].high
 *   ↳ Gap between bottom of first candle and top of third candle.
 *   ↳ Signal value = gap size (positive).
 *
 * Minimum gap size filter (minGapPct):
 *   Gap / candle[i].close × 100 must exceed minGapPct to filter noise.
 *   Default 0.1% — conservative; increase to 0.3–0.5% on noisy pairs.
 *
 * Output series (index order matches strategy condition seriesIndex):
 *   [0] bullish_fvg_signal  — 1 when a bullish FVG is detected, else 0
 *   [1] bearish_fvg_signal  — 1 when a bearish FVG is detected, else 0
 *   [2] bullish_fvg_gap_pct — gap size as % of close (only when signal = 1, else 0)
 *   [3] bearish_fvg_gap_pct — gap size as % of close (only when signal = 1, else 0)
 */

import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';

// ─── Bullish FVG ──────────────────────────────────────────────────────────────

export const bullishFVG: Indicator = {
  id:   'bullish_fvg',
  name: 'Bullish FVG',
  description:
    'Bullish Fair Value Gap (ICT). Three-candle imbalance where the high of ' +
    'candle[i-2] is below the low of candle[i], leaving a demand gap. ' +
    'Price tends to retrace into the gap before continuing upward.',
  bias: 'bullish',
  defaultParams: { minGapPct: 0.1 },
  paramsMeta: {
    minGapPct: { label: 'Min gap %', min: 0, max: 5, step: 0.05 },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const minGapPct = params['minGapPct'] ?? 0.1;

    const signalData:  { time: number; value: number }[] = [];
    const gapPctData:  { time: number; value: number }[] = [];
    const markers:     IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 2) {
        signalData.push({ time: c.openTime, value: 0 });
        gapPctData.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c0 = candles[i - 2]!; // first candle of the trio
      // c1 = candles[i - 1] — the impulse candle (not checked directly)
      // c2 = c                — completes the gap

      const gapSize = c.low - c0.high; // positive = bullish gap
      const gapPct  = c.close > 0 ? (gapSize / c.close) * 100 : 0;
      const isFVG   = gapSize > 0 && gapPct >= minGapPct;

      signalData.push({ time: c.openTime, value: isFVG ? 1 : 0 });
      gapPctData.push({ time: c.openTime, value: isFVG ? gapPct : 0 });

      if (isFVG) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#22c55e',
          shape:    'arrowUp',
          size:     1,
          text:     `FVG↑ ${gapPct.toFixed(2)}%`,
        });
      }
    }

    const signalSeries: IndicatorSeries = {
      id:         'bullish_fvg_signal',
      name:       'Bullish FVG',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#22c55e',
      markers,
    };

    const gapPctSeries: IndicatorSeries = {
      id:         'bullish_fvg_gap_pct',
      name:       'Bullish FVG Gap %',
      data:       gapPctData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#86efac',
    };

    return [signalSeries, gapPctSeries];
  },
};

// ─── Bearish FVG ──────────────────────────────────────────────────────────────

export const bearishFVG: Indicator = {
  id:   'bearish_fvg',
  name: 'Bearish FVG',
  description:
    'Bearish Fair Value Gap (ICT). Three-candle imbalance where the low of ' +
    'candle[i-2] is above the high of candle[i], leaving a supply gap. ' +
    'Price tends to retrace into the gap before continuing downward.',
  bias: 'bearish',
  defaultParams: { minGapPct: 0.1 },
  paramsMeta: {
    minGapPct: { label: 'Min gap %', min: 0, max: 5, step: 0.05 },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const minGapPct = params['minGapPct'] ?? 0.1;

    const signalData: { time: number; value: number }[] = [];
    const gapPctData: { time: number; value: number }[] = [];
    const markers:    IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < 2) {
        signalData.push({ time: c.openTime, value: 0 });
        gapPctData.push({ time: c.openTime, value: 0 });
        continue;
      }

      const c0 = candles[i - 2]!;

      const gapSize = c0.low - c.high; // positive = bearish gap
      const gapPct  = c.close > 0 ? (gapSize / c.close) * 100 : 0;
      const isFVG   = gapSize > 0 && gapPct >= minGapPct;

      signalData.push({ time: c.openTime, value: isFVG ? 1 : 0 });
      gapPctData.push({ time: c.openTime, value: isFVG ? gapPct : 0 });

      if (isFVG) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#ef4444',
          shape:    'arrowDown',
          size:     1,
          text:     `FVG↓ ${gapPct.toFixed(2)}%`,
        });
      }
    }

    const signalSeries: IndicatorSeries = {
      id:         'bearish_fvg_signal',
      name:       'Bearish FVG',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#ef4444',
      markers,
    };

    const gapPctSeries: IndicatorSeries = {
      id:         'bearish_fvg_gap_pct',
      name:       'Bearish FVG Gap %',
      data:       gapPctData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#fca5a5',
    };

    return [signalSeries, gapPctSeries];
  },
};
