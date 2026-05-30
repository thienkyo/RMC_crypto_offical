/**
 * OHLCV delta approximation — estimates buy/sell volume split without aggTrades.
 *
 * When real aggTrades data is unavailable (Phase A fallback or historical bars
 * before the aggTrades accumulator was running), we approximate buy/sell volume
 * from OHLCV using a simple but reasonably accurate heuristic.
 *
 * THE HEURISTIC — Candle position ratio:
 *
 *   ratio = (close − low) / (high − low)
 *
 *   ratio ≈ 1.0 → strong close near the high → mostly buy-side pressure
 *   ratio ≈ 0.0 → weak close near the low    → mostly sell-side pressure
 *   ratio ≈ 0.5 → balanced bar
 *
 *   buy_volume  ≈ volume × ratio
 *   sell_volume ≈ volume × (1 − ratio)
 *
 * Accuracy:
 *   This is a structural approximation — it can't distinguish high-volume
 *   wicks from sustained directional flow.  For CVD purposes it provides a
 *   "price-weighted" delta that correlates well with true delta on trending bars
 *   but overestimates buy/sell symmetry on spinning tops / doji candles.
 *
 *   Use real aggTrades data whenever available; this function is the fallback.
 *
 * Edge cases:
 *   • Flat candle (high === low): ratio = 0.5 (neutral, volume split 50/50).
 *   • volume = 0: both outputs are 0.
 */

import type { Candle } from '@/types/market';

export interface CandleDelta {
  openTime:   number;
  buyVolume:  number;
  sellVolume: number;
  /** Cumulative delta: buyVolume − sellVolume */
  delta:      number;
}

/**
 * Estimate buy and sell volume for a single candle.
 */
export function approximateDelta(candle: Candle): CandleDelta {
  const { openTime, high, low, close, volume } = candle;

  const range = high - low;
  const ratio = range > 0 ? (close - low) / range : 0.5;

  const buyVolume  = volume * ratio;
  const sellVolume = volume * (1 - ratio);

  return {
    openTime,
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
  };
}

/**
 * Compute cumulative delta series from OHLCV candles.
 *
 * Returns one CandleDelta per candle; `delta` is the running sum of
 * (buyVolume − sellVolume) across all candles (i.e. the CVD value).
 */
export function approximateCVD(candles: Candle[]): CandleDelta[] {
  const result: CandleDelta[] = [];
  let cumulative = 0;

  for (const candle of candles) {
    const d = approximateDelta(candle);
    cumulative += d.delta;
    result.push({ ...d, delta: cumulative });
  }

  return result;
}
