/**
 * Volume Absorption patterns — Order Flow concept.
 *
 * Absorption occurs when a large amount of volume is traded but price moves
 * very little — someone is absorbing (taking the other side of) aggressive
 * orders.  This signals hidden institutional interest at a price level.
 *
 * BULLISH ABSORPTION (demand absorption):
 *   High volume + small body that CLOSES BULLISH (green) + body is small
 *   relative to candle range → sellers tried to push price down, buyers
 *   absorbed all the selling, price recovered → bullish reversal signal.
 *
 * BEARISH ABSORPTION (supply absorption):
 *   Mirror: high volume + small body that CLOSES BEARISH (red) → buyers
 *   tried to push price up, sellers absorbed all the buying → bearish signal.
 *
 * Parameters:
 *   volumeLookback   — bars to average volume over for the "high volume" threshold (default 20).
 *   volumeMultiplier — minimum ratio of bar volume to average (default 1.5 = 50% above avg).
 *   maxBodyPct       — maximum body size as % of candle range (default 30%) — the "small body" filter.
 *
 * Output series (seriesIndex for strategy conditions):
 *   [0] signal          — 1 when pattern fires, else 0
 *   [1] volume_ratio    — bar_volume / avg_volume (only when signal = 1, else 0)
 *
 * Why OHLCV-only:
 *   True absorption detection uses per-price-level delta from aggTrades, but
 *   a high-volume / small-body candle is a reliable proxy available from OHLCV
 *   alone.  Use real CVD data (Step 12) for confirmation.
 */

import type { Indicator, IndicatorResult, IndicatorSeries, IndicatorMarker } from '@/lib/indicators/types';
import type { Candle } from '@/types/market';
import { isGreen, isRed } from './utils';

// ─── Shared absorption computation ───────────────────────────────────────────

function computeAbsorption(
  candles:   Candle[],
  params:    Record<string, number>,
  direction: 'bullish' | 'bearish',
): { signalData: IndicatorSeries['data']; ratioData: IndicatorSeries['data']; markers: IndicatorMarker[] } {
  const lookback   = Math.max(2, Math.round(params['volumeLookback']   ?? 20));
  const multiplier = params['volumeMultiplier'] ?? 1.5;
  const maxBodyPct = params['maxBodyPct']        ?? 30;

  const signalData: { time: number; value: number }[] = [];
  const ratioData:  { time: number; value: number }[] = [];
  const markers:    IndicatorMarker[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    if (i < lookback) {
      signalData.push({ time: c.openTime, value: 0 });
      ratioData.push ({ time: c.openTime, value: 0 });
      continue;
    }

    // Average volume over the last `lookback` bars (excluding current)
    let sumVol = 0;
    for (let j = i - lookback; j < i; j++) sumVol += candles[j]!.volume;
    const avgVol = sumVol / lookback;

    // Volume threshold
    const volRatio   = avgVol > 0 ? c.volume / avgVol : 0;
    const isHighVol  = volRatio >= multiplier;

    // Body size relative to range — small body = absorption
    const range      = c.high - c.low;
    const bodySize   = Math.abs(c.close - c.open);
    const bodyPct    = range > 0 ? (bodySize / range) * 100 : 100;
    const isSmallBody = bodyPct <= maxBodyPct;

    // Direction check
    const directionMatches = direction === 'bullish' ? isGreen(c) : isRed(c);

    const isPattern = isHighVol && isSmallBody && directionMatches;

    signalData.push({ time: c.openTime, value: isPattern ? 1 : 0 });
    ratioData.push ({ time: c.openTime, value: isPattern ? volRatio : 0 });

    if (isPattern) {
      markers.push({
        time:     c.openTime,
        position: direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color:    direction === 'bullish' ? '#06b6d4' : '#8b5cf6',
        shape:    direction === 'bullish' ? 'circle'  : 'circle',
        size:     2,
        text:     `Abs ${direction === 'bullish' ? '↑' : '↓'} ${volRatio.toFixed(1)}×`,
      });
    }
  }

  return { signalData, ratioData, markers };
}

// ─── Bullish Absorption ───────────────────────────────────────────────────────

export const bullishAbsorption: Indicator = {
  id:   'bullish_absorption',
  name: 'Bullish Absorption',
  description:
    'Bullish Volume Absorption. High-volume green candle with a small body ' +
    'relative to its range — sellers were absorbed by demand at this level. ' +
    'Signals hidden institutional buying.',
  bias: 'bullish',
  defaultParams: { volumeLookback: 20, volumeMultiplier: 1.5, maxBodyPct: 30 },
  paramsMeta: {
    volumeLookback:   { label: 'Volume lookback', min: 5,   max: 200, step: 1    },
    volumeMultiplier: { label: 'Min volume ×',    min: 1.0, max: 10,  step: 0.1  },
    maxBodyPct:       { label: 'Max body %',      min: 5,   max: 80,  step: 1    },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const { signalData, ratioData, markers } = computeAbsorption(candles, params, 'bullish');

    const signalSeries: IndicatorSeries = {
      id:         'bullish_absorption_signal',
      name:       'Bullish Absorption',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#06b6d4',
      markers,
    };

    const ratioSeries: IndicatorSeries = {
      id:         'bullish_absorption_ratio',
      name:       'Bullish Abs Volume ×',
      data:       ratioData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#67e8f9',
    };

    return [signalSeries, ratioSeries];
  },
};

// ─── Bearish Absorption ───────────────────────────────────────────────────────

export const bearishAbsorption: Indicator = {
  id:   'bearish_absorption',
  name: 'Bearish Absorption',
  description:
    'Bearish Volume Absorption. High-volume red candle with a small body ' +
    'relative to its range — buyers were absorbed by supply at this level. ' +
    'Signals hidden institutional selling.',
  bias: 'bearish',
  defaultParams: { volumeLookback: 20, volumeMultiplier: 1.5, maxBodyPct: 30 },
  paramsMeta: {
    volumeLookback:   { label: 'Volume lookback', min: 5,   max: 200, step: 1    },
    volumeMultiplier: { label: 'Min volume ×',    min: 1.0, max: 10,  step: 0.1  },
    maxBodyPct:       { label: 'Max body %',      min: 5,   max: 80,  step: 1    },
  },

  compute(candles: Candle[], params: Record<string, number>): IndicatorResult {
    const { signalData, ratioData, markers } = computeAbsorption(candles, params, 'bearish');

    const signalSeries: IndicatorSeries = {
      id:         'bearish_absorption_signal',
      name:       'Bearish Absorption',
      data:       signalData,
      panel:      'sub',
      seriesType: 'histogram',
      color:      '#8b5cf6',
      markers,
    };

    const ratioSeries: IndicatorSeries = {
      id:         'bearish_absorption_ratio',
      name:       'Bearish Abs Volume ×',
      data:       ratioData,
      panel:      'sub',
      seriesType: 'line',
      color:      '#c4b5fd',
    };

    return [signalSeries, ratioSeries];
  },
};
