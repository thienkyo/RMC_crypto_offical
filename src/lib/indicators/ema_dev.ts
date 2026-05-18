/**
 * EMA Deviation — percentage distance of the closing price from its EMA.
 *
 *   EMA Dev = (Close − EMA(period)) / EMA(period) × 100
 *
 * Interpretation:
 *   +5.0  → price is 5% ABOVE the EMA (overextended bullish)
 *    0.0  → price is exactly on the EMA
 *   -5.0  → price is 5% BELOW the EMA (overextended bearish / mean-reversion setup)
 *
 * Why this is useful:
 *   The strategy condition builder can only compare an indicator series to a
 *   fixed numeric threshold.  Raw EMA values track price (BTC EMA(200) ≈ $58 000)
 *   so a fixed threshold would be useless.  EMA Deviation normalises the
 *   distance into percentage terms, making conditions like
 *   "ema_dev(200) < -5" (price ≥ 5% below 200 EMA) portable across assets.
 *
 * Typical thresholds (daily BTC):
 *   <  -5%  → meaningful pullback below long-term average (mean-reversion long)
 *   >  +5%  → meaningful extension above average (mean-reversion short)
 *   <   0   → below EMA = bearish structural zone
 *   >   0   → above EMA = bullish structural zone
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface EmaDevParams { period: number; [key: string]: number }

export const ema_dev: Indicator<EmaDevParams> = {
  id:   'ema_dev',
  name: 'EMA Deviation',
  description:
    'EMA Deviation. Percentage distance between the closing price and its EMA: ' +
    '(Close − EMA) / EMA × 100. Positive = price above EMA, negative = below. ' +
    'Use as a structural filter: e.g. ema_dev(200) < -5 = price is ≥5% below the ' +
    '200-period EMA (oversold relative to long-term baseline — mean-reversion long setup).',
  defaultParams: { period: 200 },
  paramsMeta: {
    period: { label: 'EMA Period', min: 2, max: 500, step: 1 },
  },

  compute(candles: Candle[], { period }: EmaDevParams): IndicatorResult {
    const p = Math.max(2, Math.round(period));
    if (candles.length < p) return [];

    const data: { time: number; value: number }[] = [];

    // Wilder/standard EMA using the 2/(p+1) multiplier
    const k = 2 / (p + 1);

    // Seed with SMA of the first p bars
    let ema = candles.slice(0, p).reduce((s, c) => s + c.close, 0) / p;

    // Emit first value at index p-1
    {
      const c = candles[p - 1]!;
      const dev = ema > 0 ? ((c.close - ema) / ema) * 100 : 0;
      data.push({ time: c.openTime, value: dev });
    }

    for (let i = p; i < candles.length; i++) {
      ema = candles[i]!.close * k + ema * (1 - k);
      const dev = ema > 0 ? ((candles[i]!.close - ema) / ema) * 100 : 0;
      data.push({ time: candles[i]!.openTime, value: dev });
    }

    return [
      {
        id:         `ema_dev_${p}`,
        name:       `EMA(${p}) Dev %`,
        data,
        panel:      'sub',
        color:      '#fb923c', // orange — warm colour distinct from EMA line
        lineWidth:  1.5,
        seriesType: 'line',
      },
    ];
  },
};
