import type { Candle } from '@/types/market';

export interface BollingerStatPoint {
  time: number;
  close: number;
  mean: number;
  stdDev: number;
  upper: number;
  lower: number;
}

/**
 * Standard Exponential Moving Average (EMA) over an array of numbers.
 * Seeds with the Simple Moving Average (SMA) of the first `period` elements,
 * and returns a full-length array with `NaN` for indices `< period - 1`.
 */
export function emaArray(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) out.push(NaN);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/**
 * Simple Moving Average (SMA) over an array of numbers.
 * Returns a full-length array with `NaN` for indices `< period - 1`.
 */
export function smaArray(values: number[], period: number): number[] {
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

/**
 * Wilder's RSI algorithm over an array of candles.
 * Returns an array of RSI values aligned to `candles[period]`, `candles[period + 1]`, ...
 */
export function computeWilderRsiValues(candles: Candle[], period: number): number[] {
  const out: number[] = [];
  if (candles.length < period + 1 || period <= 0) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i]!.close - candles[i - 1]!.close;
    avgGain += d > 0 ? d : 0;
    avgLoss += d < 0 ? -d : 0;
  }
  avgGain /= period;
  avgLoss /= period;

  const rsiVal = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out.push(rsiVal(avgGain, avgLoss));

  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i]!.close - candles[i - 1]!.close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push(rsiVal(avgGain, avgLoss));
  }

  return out;
}

/**
 * Rolling Bollinger Bands statistics (mean, standard deviation, upper, lower)
 * aligned from index `period - 1` to `candles.length - 1`.
 */
export function computeBollingerStats(
  candles: Candle[],
  period: number,
  stdDevMult: number,
): BollingerStatPoint[] {
  if (candles.length < period || period <= 0) return [];

  const stats: BollingerStatPoint[] = [];
  let rollingSum = candles.slice(0, period).reduce((s, c) => s + c.close, 0);

  for (let i = period - 1; i < candles.length; i++) {
    if (i >= period) rollingSum += candles[i]!.close - candles[i - period]!.close;

    const mean = rollingSum / period;
    let sumSqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j]!.close - mean;
      sumSqDiff += d * d;
    }
    const stdDev = Math.sqrt(sumSqDiff / period);
    const upper = mean + stdDevMult * stdDev;
    const lower = mean - stdDevMult * stdDev;

    stats.push({
      time: candles[i]!.openTime,
      close: candles[i]!.close,
      mean,
      stdDev,
      upper,
      lower,
    });
  }

  return stats;
}
