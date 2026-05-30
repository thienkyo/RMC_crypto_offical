/**
 * Liquidity Sweep patterns — ICT concept.
 *
 * A liquidity sweep occurs when price briefly pierces a prior swing
 * high/low (collecting stop-loss orders sitting there), then sharply
 * reverses within the same or next candle.  Institutional traders call
 * this "stop hunting" — the reversal after the sweep is the high-
 * probability entry signal.
 *
 * BULLISH LIQUIDITY SWEEP (sweep of lows → long entry):
 *   1. Identify the lowest low over the last `lookback` bars (swing low).
 *   2. Current candle's LOW pierces below that swing low.
 *   3. Current candle CLOSES above the swing low (wick sweep + recovery).
 *   ↳ Buyers absorbed the selling — bullish reversal likely.
 *
 * BEARISH LIQUIDITY SWEEP (sweep of highs → short entry):
 *   1. Identify the highest high over the last `lookback` bars (swing high).
 *   2. Current candle's HIGH pierces above that swing high.
 *   3. Current candle CLOSES below the swing high (wick sweep + rejection).
 *   ↳ Sellers absorbed the buying — bearish reversal likely.
 *
 * Parameters:
 *   lookback  — bars to look back for the swing level (default 20).
 *   minWickPct — minimum wick-beyond-level as % of close to filter micro-sweeps
 *                (default 0.05%).
 *
 * Output series (seriesIndex for strategy conditions):
 *   [0] signal  — 1 when pattern fires, else 0
 *   [1] wick_pct — how far price pierced the level as % of close (only when signal = 1)
 */

import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';

// ─── Bullish Liquidity Sweep ──────────────────────────────────────────────────

export const bullishLiquiditySweep: Indicator = {
  id:   'bullish_liquidity_sweep',
  name: 'Bullish Liquidity Sweep',
  description:
    'Bullish Liquidity Sweep (ICT). Price pierces below a prior swing low ' +
    'then closes back above it, signalling that sell-side liquidity has been ' +
    'taken and a bullish reversal is likely.',
  bias: 'bullish',
  defaultParams: { lookback: 20, minWickPct: 0.05 },
  paramsMeta: {
    lookback:   { label: 'Lookback bars', min: 5,  max: 200, step: 1    },
    minWickPct: { label: 'Min wick %',    min: 0,  max: 5,   step: 0.01 },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const lookback   = Math.max(2, Math.round(params['lookback']   ?? 20));
    const minWickPct = params['minWickPct'] ?? 0.05;

    const signalData:  { time: number; value: number }[] = [];
    const wickPctData: { time: number; value: number }[] = [];
    const markers:     IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < lookback) {
        signalData.push({ time: c.openTime, value: 0 });
        wickPctData.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Swing low = minimum low of the previous `lookback` bars (excluding current)
      let swingLow = Infinity;
      for (let j = i - lookback; j < i; j++) {
        if (candles[j]!.low < swingLow) swingLow = candles[j]!.low;
      }

      // Conditions: wick below swing low + close recovers above it
      const pierced   = c.low  < swingLow;
      const recovered = c.close > swingLow;
      const wickPct   = pierced && c.close > 0
        ? ((swingLow - c.low) / c.close) * 100
        : 0;
      const isSweep   = pierced && recovered && wickPct >= minWickPct;

      signalData.push({ time: c.openTime, value: isSweep ? 1 : 0 });
      wickPctData.push({ time: c.openTime, value: isSweep ? wickPct : 0 });

      if (isSweep) {
        markers.push({
          time:     c.openTime,
          position: 'belowBar',
          color:    '#a78bfa',
          shape:    'arrowUp',
          size:     1,
          text:     `LS↑ ${wickPct.toFixed(2)}%`,
        });
      }
    }

    const signalSeries: IndicatorSeries = {
      id:         'bullish_liquidity_sweep_signal',
      name:       'Bullish Liquidity Sweep',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#a78bfa',
      markers,
    };

    const wickPctSeries: IndicatorSeries = {
      id:         'bullish_liquidity_sweep_wick_pct',
      name:       'Bullish LS Wick %',
      data:       wickPctData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#c4b5fd',
    };

    return [signalSeries, wickPctSeries];
  },
};

// ─── Bearish Liquidity Sweep ──────────────────────────────────────────────────

export const bearishLiquiditySweep: Indicator = {
  id:   'bearish_liquidity_sweep',
  name: 'Bearish Liquidity Sweep',
  description:
    'Bearish Liquidity Sweep (ICT). Price pierces above a prior swing high ' +
    'then closes back below it, signalling that buy-side liquidity has been ' +
    'taken and a bearish reversal is likely.',
  bias: 'bearish',
  defaultParams: { lookback: 20, minWickPct: 0.05 },
  paramsMeta: {
    lookback:   { label: 'Lookback bars', min: 5,  max: 200, step: 1    },
    minWickPct: { label: 'Min wick %',    min: 0,  max: 5,   step: 0.01 },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const lookback   = Math.max(2, Math.round(params['lookback']   ?? 20));
    const minWickPct = params['minWickPct'] ?? 0.05;

    const signalData:  { time: number; value: number }[] = [];
    const wickPctData: { time: number; value: number }[] = [];
    const markers:     IndicatorMarker[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;

      if (i < lookback) {
        signalData.push({ time: c.openTime, value: 0 });
        wickPctData.push({ time: c.openTime, value: 0 });
        continue;
      }

      // Swing high = maximum high of the previous `lookback` bars (excluding current)
      let swingHigh = -Infinity;
      for (let j = i - lookback; j < i; j++) {
        if (candles[j]!.high > swingHigh) swingHigh = candles[j]!.high;
      }

      const pierced   = c.high  > swingHigh;
      const recovered = c.close < swingHigh;
      const wickPct   = pierced && c.close > 0
        ? ((c.high - swingHigh) / c.close) * 100
        : 0;
      const isSweep   = pierced && recovered && wickPct >= minWickPct;

      signalData.push({ time: c.openTime, value: isSweep ? 1 : 0 });
      wickPctData.push({ time: c.openTime, value: isSweep ? wickPct : 0 });

      if (isSweep) {
        markers.push({
          time:     c.openTime,
          position: 'aboveBar',
          color:    '#f97316',
          shape:    'arrowDown',
          size:     1,
          text:     `LS↓ ${wickPct.toFixed(2)}%`,
        });
      }
    }

    const signalSeries: IndicatorSeries = {
      id:         'bearish_liquidity_sweep_signal',
      name:       'Bearish Liquidity Sweep',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#f97316',
      markers,
    };

    const wickPctSeries: IndicatorSeries = {
      id:         'bearish_liquidity_sweep_wick_pct',
      name:       'Bearish LS Wick %',
      data:       wickPctData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#fdba74',
    };

    return [signalSeries, wickPctSeries];
  },
};
