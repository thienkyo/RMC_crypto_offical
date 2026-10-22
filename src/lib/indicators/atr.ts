/**
 * ATR — Average True Range (Wilder smoothing)
 *
 * Measures average bar-to-bar volatility in price units.
 * Used for volatility-adjusted stop-loss placement and noise evaluation.
 */
import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface AtrParams {
  period: number;
  [key: string]: number;
}

export const atr: Indicator<AtrParams> = {
  id: 'atr',
  name: 'ATR',
  description:
    'Average True Range (Wilder method). Measures market volatility in price units. ' +
    'Useful for sizing stop-losses outside normal market noise (1.5x–2.5x ATR).',
  defaultParams: { period: 14 },
  paramsMeta: {
    period: { label: 'Period', min: 2, max: 100, step: 1 },
  },

  compute(candles: Candle[], { period }: AtrParams): IndicatorResult {
    const p = Math.max(2, Math.round(period));
    if (candles.length <= p) return [];

    const tr: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const cur = candles[i]!;
      const prev = candles[i - 1]!;
      const highLow = cur.high - cur.low;
      const highClose = Math.abs(cur.high - prev.close);
      const lowClose = Math.abs(cur.low - prev.close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }

    // Initial ATR is simple average of first p True Ranges
    let currentAtr = tr.slice(0, p).reduce((sum, val) => sum + val, 0) / p;
    const atrData: { time: number; value: number }[] = [
      { time: candles[p]!.openTime, value: currentAtr },
    ];

    // Wilder smoothing for subsequent bars
    for (let i = p; i < tr.length; i++) {
      currentAtr = (currentAtr * (p - 1) + tr[i]!) / p;
      atrData.push({ time: candles[i + 1]!.openTime, value: currentAtr });
    }

    return [
      {
        id: `atr_${p}`,
        name: `ATR ${p}`,
        data: atrData,
        panel: 'sub',
        color: '#38bdf8',
        lineWidth: 1.5,
        seriesType: 'line',
      },
    ];
  },
};
