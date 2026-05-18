/**
 * Volume Ratio — current bar volume divided by the N-period SMA of volume.
 *
 *   Volume Ratio = Volume[i] / SMA(Volume, period)
 *
 * Interpretation:
 *   1.0  → volume is exactly at its average
 *   1.5  → volume is 50% above average (mild spike)
 *   2.0  → volume is double the average (strong spike)
 *   3.0+ → exceptional spike (news event, liquidation cascade, etc.)
 *
 * Why ratio instead of raw volume:
 *   Raw volume is asset- and exchange-dependent (BTCUSDT ≠ SOLUSDT). A ratio
 *   normalises across all symbols and makes strategy thresholds portable.
 *
 * Strategy use: set condition "volume_ratio > 1.5" to confirm that a price
 * move has real conviction behind it — not just a thin-market drift.
 */
import type { Candle }          from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface VolumeRatioParams { period: number; [key: string]: number }

export const volume_ratio: Indicator<VolumeRatioParams> = {
  id:   'volume_ratio',
  name: 'Volume Ratio',
  description:
    'Volume Ratio. Current bar volume divided by its N-period SMA. ' +
    '1.0 = average volume. 2.0 = double the average (strong spike). ' +
    'Use as a confirmation filter — e.g. Volume Ratio > 1.5 to confirm a breakout ' +
    'has genuine participation rather than thin-market drift.',
  defaultParams: { period: 20 },
  paramsMeta: {
    period: { label: 'SMA Period', min: 2, max: 200, step: 1 },
  },

  compute(candles: Candle[], { period }: VolumeRatioParams): IndicatorResult {
    const p = Math.max(2, Math.round(period));
    if (candles.length < p) return [];

    const data: { time: number; value: number }[] = [];
    let rollingVolume = candles.slice(0, p).reduce((s, c) => s + c.volume, 0);

    for (let i = p - 1; i < candles.length; i++) {
      if (i >= p) {
        rollingVolume += candles[i]!.volume - candles[i - p]!.volume;
      }

      const avgVol = rollingVolume / p;
      // Guard against zero-volume bars (e.g. weekends on stock data)
      const ratio = avgVol > 0 ? candles[i]!.volume / avgVol : 1;

      data.push({ time: candles[i]!.openTime, value: ratio });
    }

    return [
      {
        id:         'volume_ratio',
        name:       'Volume Ratio',
        data,
        panel:      'sub',
        color:      '#34d399', // emerald — echoes volume bars on the chart
        lineWidth:  1.5,
        seriesType: 'line',
      },
    ];
  },
};
