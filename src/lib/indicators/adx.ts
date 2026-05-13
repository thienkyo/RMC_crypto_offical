/**
 * ADX — Average Directional Index (Wilder method)
 *
 * Measures trend *strength*, not direction.
 *   ADX > 25  → strong trend present (long or short)
 *   ADX < 20  → weak / ranging market
 *
 * Outputs three series:
 *   [0] ADX      — overall trend strength (0-100)
 *   [1] +DI      — positive directional indicator (bullish pressure)
 *   [2] −DI      — negative directional indicator (bearish pressure)
 *
 * Strategy tip: wait for ADX > 25, then use +DI/-DI crossover (or another
 * momentum oscillator) to pick direction.
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface AdxParams { period: number; [key: string]: number }

export const adx: Indicator<AdxParams> = {
  id:   'adx',
  name: 'ADX',
  description:
    'Average Directional Index. Measures trend strength on a 0–100 scale. ' +
    'ADX > 25 = strong trend; ADX < 20 = ranging market. ' +
    'Series: [0] ADX, [1] +DI (bullish), [2] −DI (bearish). ' +
    'Tip: use ADX > 25 as a filter, then pick direction with +DI/-DI or momentum.',
  defaultParams: { period: 14 },
  paramsMeta: {
    period: { label: 'Period', min: 2, max: 100, step: 1 },
  },

  compute(candles: Candle[], { period }: AdxParams): IndicatorResult {
    const p = Math.max(2, Math.round(period));
    // Need at least 2*p bars to produce the first ADX value
    if (candles.length < 2 * p) return [];

    // ── Step 1: raw TR, +DM, −DM (starting from bar 1) ──────────────────────
    const tr:    number[] = [];
    const plusDM:  number[] = [];
    const minusDM: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const cur  = candles[i]!;
      const prev = candles[i - 1]!;

      const highLow   = cur.high - cur.low;
      const highClose = Math.abs(cur.high - prev.close);
      const lowClose  = Math.abs(cur.low  - prev.close);
      tr.push(Math.max(highLow, highClose, lowClose));

      const upMove   = cur.high - prev.high;
      const downMove = prev.low  - cur.low;
      plusDM.push(upMove   > downMove && upMove   > 0 ? upMove   : 0);
      minusDM.push(downMove > upMove  && downMove > 0 ? downMove : 0);
    }

    // ── Step 2: Wilder smoothed TR / +DM / −DM ───────────────────────────────
    // First smoothed value = sum of first `period` raw values.
    let smTR     = tr.slice(0, p).reduce((s, v) => s + v, 0);
    let smPlus   = plusDM.slice(0, p).reduce((s, v) => s + v, 0);
    let smMinus  = minusDM.slice(0, p).reduce((s, v) => s + v, 0);

    const plusDIArr:  number[] = [];
    const minusDIArr: number[] = [];
    const dxArr:      number[] = [];

    function pushDI(): void {
      const pDI = smTR > 0 ? 100 * smPlus  / smTR : 0;
      const mDI = smTR > 0 ? 100 * smMinus / smTR : 0;
      plusDIArr.push(pDI);
      minusDIArr.push(mDI);
      const diSum  = pDI + mDI;
      dxArr.push(diSum > 0 ? 100 * Math.abs(pDI - mDI) / diSum : 0);
    }

    pushDI(); // first DI at bar index `period` (0-based in the DI arrays)

    for (let i = p; i < tr.length; i++) {
      smTR    = smTR    - smTR    / p + tr[i]!;
      smPlus  = smPlus  - smPlus  / p + plusDM[i]!;
      smMinus = smMinus - smMinus / p + minusDM[i]!;
      pushDI();
    }

    // ── Step 3: ADX = Wilder smooth of DX ────────────────────────────────────
    // First ADX = average of first `period` DX values.
    let adxVal = dxArr.slice(0, p).reduce((s, v) => s + v, 0) / p;
    const adxArr: number[] = [adxVal];

    for (let i = p; i < dxArr.length; i++) {
      adxVal = (adxVal * (p - 1) + dxArr[i]!) / p;
      adxArr.push(adxVal);
    }

    // ── Map back to candle timestamps ─────────────────────────────────────────
    // DI arrays align to candles[p], candles[p+1], …  (DI has length = tr.length - p + 1)
    // ADX arrays align to candles[2p], candles[2p+1], …
    const adxStart = 2 * p; // first candle index with an ADX value

    const adxData:   { time: number; value: number }[] = [];
    const plusData:  { time: number; value: number }[] = [];
    const minusData: { time: number; value: number }[] = [];

    for (let i = 0; i < adxArr.length; i++) {
      const ci = adxStart + i;
      if (ci >= candles.length) break;
      const t = candles[ci]!.openTime;
      adxData.push({ time: t, value: adxArr[i]! });
      // DI offset: DI[i + p] aligns with candle[ci]
      plusData.push({  time: t, value: plusDIArr[i + p]!  });
      minusData.push({ time: t, value: minusDIArr[i + p]! });
    }

    return [
      {
        id: `adx_${p}`, name: `ADX ${p}`,
        data: adxData, panel: 'sub',
        color: '#f59e0b', lineWidth: 2, seriesType: 'line',
      },
      {
        id: `adx_plus_${p}`, name: `+DI ${p}`,
        data: plusData, panel: 'sub',
        color: '#10b981', lineWidth: 1.5, seriesType: 'line',
      },
      {
        id: `adx_minus_${p}`, name: `−DI ${p}`,
        data: minusData, panel: 'sub',
        color: '#ef4444', lineWidth: 1.5, seriesType: 'line',
      },
    ];
  },
};
