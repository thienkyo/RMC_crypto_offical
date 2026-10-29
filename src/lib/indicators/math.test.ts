import { describe, it, expect } from 'vitest';
import {
  emaArray,
  smaArray,
  computeWilderRsiValues,
  computeBollingerStats,
} from './math';
import { ema } from './ema';
import { ema_dev } from './ema_dev';
import { macd } from './macd';
import { rsi } from './rsi';
import { stochrsi } from './stochrsi';
import { bollinger } from './bollinger';
import { bbpct } from './bbpct';
import { bb_width } from './bb_width';
import type { Candle } from '@/types/market';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, idx) => ({
    openTime: 1000 + idx * 60,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100,
    closeTime: 1000 + (idx + 1) * 60 - 1,
  }));
}

describe('indicators/math shared primitives', () => {
  it('computes emaArray accurately with NaN warm-up prefix', () => {
    const values = [10, 12, 14, 16, 18, 20];
    const res = emaArray(values, 3);
    expect(res.length).toBe(6);
    expect(Number.isNaN(res[0]!)).toBe(true);
    expect(Number.isNaN(res[1]!)).toBe(true);
    // Seed SMA(3) of [10, 12, 14] = 12
    expect(res[2]).toBeCloseTo(12, 8);
    // Next k = 2/(3+1) = 0.5 -> 16 * 0.5 + 12 * 0.5 = 14
    expect(res[3]).toBeCloseTo(14, 8);
    expect(res[4]).toBeCloseTo(16, 8);
    expect(res[5]).toBeCloseTo(18, 8);
  });

  it('computes smaArray accurately with NaN warm-up prefix', () => {
    const values = [2, 4, 6, 8, 10];
    const res = smaArray(values, 3);
    expect(res.length).toBe(5);
    expect(Number.isNaN(res[0]!)).toBe(true);
    expect(Number.isNaN(res[1]!)).toBe(true);
    expect(res[2]).toBeCloseTo(4, 8);
    expect(res[3]).toBeCloseTo(6, 8);
    expect(res[4]).toBeCloseTo(8, 8);
  });

  it('computes Wilder RSI values and keeps rsi and stochrsi in sync', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i * 0.5) * 10 + i * 0.3);
    const candles = makeCandles(closes);

    const rawRsi = computeWilderRsiValues(candles, 14);
    const rsiSeries = rsi.compute(candles, { period: 14, emaPeriod: 10 });
    expect(rsiSeries.length).toBe(2);
    expect(rsiSeries[0]!.data.map((d) => d.value)).toEqual(rawRsi);

    const stochSeries = stochrsi.compute(candles, {
      rsiPeriod: 14,
      stochPeriod: 14,
      kSmooth: 3,
      dSmooth: 3,
    });
    expect(stochSeries.length).toBe(2);
    expect(stochSeries[0]!.data.length).toBeGreaterThan(0);
    expect(stochSeries[1]!.data.length).toBeGreaterThan(0);
  });

  it('computes Bollinger stats consistently across bollinger, bbpct, and bb_width', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 50 + (i % 5) * 2 + i * 0.5);
    const candles = makeCandles(closes);

    const stats = computeBollingerStats(candles, 10, 2);
    expect(stats.length).toBe(21);

    const bbRes = bollinger.compute(candles, { period: 10, stdDevMult: 2 });
    const pctRes = bbpct.compute(candles, { period: 10, stdDevMult: 2 });
    const widthRes = bb_width.compute(candles, { period: 10, stdDevMult: 2 });

    expect(bbRes[0]!.data.length).toBe(21);
    expect(pctRes[0]!.data.length).toBe(21);
    expect(widthRes[0]!.data.length).toBe(21);

    // At each bar, verify mathematical relationship:
    // pctB = (close - lower) / (upper - lower)
    // width = (upper - lower) / middle * 100
    for (let i = 0; i < stats.length; i++) {
      const mid = bbRes[0]!.data[i]!.value;
      const up = bbRes[1]!.data[i]!.value;
      const lo = bbRes[2]!.data[i]!.value;
      const close = candles[i + 9]!.close;

      expect(pctRes[0]!.data[i]!.value).toBeCloseTo((close - lo) / (up - lo), 10);
      expect(widthRes[0]!.data[i]!.value).toBeCloseTo(((up - lo) / mid) * 100, 10);
    }
  });

  it('preserves ema, ema_dev, and macd calculations', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 + Math.cos(i * 0.3) * 15 + i);
    const candles = makeCandles(closes);

    const emaRes = ema.compute(candles, { period: 10 });
    const devRes = ema_dev.compute(candles, { period: 10 });
    expect(emaRes[0]!.data.length).toBe(51);
    expect(devRes[0]!.data.length).toBe(51);

    for (let i = 0; i < 51; i++) {
      const e = emaRes[0]!.data[i]!.value;
      const c = candles[i + 9]!.close;
      expect(devRes[0]!.data[i]!.value).toBeCloseTo(((c - e) / e) * 100, 10);
    }

    const macdRes = macd.compute(candles, { fast: 12, slow: 26, signal: 9, trendEma: 40 });
    expect(macdRes.length).toBe(4);
    expect(macdRes[0]!.data.length).toBe(20);
  });
});
