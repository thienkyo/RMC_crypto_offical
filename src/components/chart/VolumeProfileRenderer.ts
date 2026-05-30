/**
 * Volume Profile Histogram — LWC ISeriesPrimitive renderer.
 *
 * Attaches to the candlestick series and draws:
 *   1. A horizontal histogram on the RIGHT side of the price chart.
 *   2. Horizontal lines for VAH / POC / VAL across the full chart width
 *      (when config.showLines = true).
 *
 * Color coding:
 *   POC bar / line  — bright orange  (#ff6b35)  solid
 *   VA bars         — teal           (#14b8a6)  at 70% opacity
 *   Outside-VA bars — slate          (#64748b)  at 35% opacity
 *   VAH / VAL lines — amber dashed   (#fbbf24)
 *   POC line        — orange solid   (#ff6b35)
 */

import type {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
} from 'lightweight-charts';
import type { Candle } from '@/types/market';
import type { VolumeProfileConfig } from '@/store/chart';

export interface ProfileLevels {
  vah: number;
  poc: number;
  val: number;
}

interface ProfileBin {
  priceLow:  number;
  priceHigh: number;
  volume:    number;
  isVA:      boolean;
  isPOC:     boolean;
}

interface ComputedProfile {
  bins:   ProfileBin[];
  levels: ProfileLevels;
}

// Maximum histogram width as a fraction of the pane width.
const MAX_BAR_WIDTH_FRACTION = 0.20;

export class VolumeProfileRenderer implements ISeriesPrimitive {
  private _config:  VolumeProfileConfig;
  private _candles: Candle[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series:  any | null = null;

  constructor(config: VolumeProfileConfig) {
    this._config = { ...config };
  }

  // ── LWC lifecycle ──────────────────────────────────────────────────────────

  attached({ series }: SeriesAttachedParameter): void {
    this._series = series;
  }

  detached(): void {
    this._series = null;
  }

  updateAllViews(): void { /* intentional no-op — state lives in _candles/_config */ }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return [this._buildPaneView()];
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setConfig(config: VolumeProfileConfig): void {
    this._config = { ...config };
  }

  setCandles(candles: Candle[]): void {
    this._candles = candles;
  }

  // ── Profile computation ────────────────────────────────────────────────────

  private _computeProfile(): ComputedProfile | null {
    const { lookback, bins, valueAreaPct } = this._config;
    const candles = this._candles;
    if (candles.length < 2) return null;

    const window = candles.slice(Math.max(0, candles.length - lookback));

    let rangeHigh = -Infinity;
    let rangeLow  =  Infinity;
    for (const c of window) {
      if (c.high > rangeHigh) rangeHigh = c.high;
      if (c.low  < rangeLow)  rangeLow  = c.low;
    }
    if (rangeHigh <= rangeLow) return null;

    const binSize = (rangeHigh - rangeLow) / bins;
    const volBins = new Float64Array(bins);

    for (const c of window) {
      const s = Math.max(0, Math.min(bins - 1, Math.floor((c.low  - rangeLow) / binSize)));
      const e = Math.max(0, Math.min(bins - 1, Math.floor((c.high - rangeLow) / binSize)));
      const perBin = c.volume / (e - s + 1);
      for (let b = s; b <= e; b++) volBins[b]! += perBin;
    }

    // POC
    let pocBin = 0, maxVol = 0;
    for (let b = 0; b < bins; b++) {
      if (volBins[b]! > maxVol) { maxVol = volBins[b]!; pocBin = b; }
    }

    // Value Area expansion from POC outward
    const totalVol = volBins.reduce((s, v) => s + v, 0);
    const vaTarget = totalVol * (valueAreaPct / 100);
    let vaVol = volBins[pocBin]!, vaLow = pocBin, vaHigh = pocBin;
    while (vaVol < vaTarget && (vaLow > 0 || vaHigh < bins - 1)) {
      const above = vaHigh < bins - 1 ? volBins[vaHigh + 1]! : 0;
      const below = vaLow  > 0        ? volBins[vaLow  - 1]! : 0;
      if (above >= below) { vaHigh++; vaVol += above; }
      else                { vaLow--;  vaVol += below; }
    }

    const profileBins: ProfileBin[] = Array.from({ length: bins }, (_, b) => ({
      priceLow:  rangeLow + b * binSize,
      priceHigh: rangeLow + (b + 1) * binSize,
      volume:    volBins[b]!,
      isVA:      b >= vaLow && b <= vaHigh,
      isPOC:     b === pocBin,
    }));

    return {
      bins:   profileBins,
      levels: {
        vah: rangeLow + (vaHigh + 1) * binSize,
        poc: rangeLow + (pocBin + 0.5) * binSize,
        val: rangeLow + vaLow * binSize,
      },
    };
  }

  // ── Pane view ──────────────────────────────────────────────────────────────

  private _buildPaneView(): ISeriesPrimitivePaneView {
    const getProfile   = () => this._computeProfile();
    const getSeries    = () => this._series;
    const getShowLines = () => this._config.showLines;

    const paneRenderer: ISeriesPrimitivePaneRenderer = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      draw(target: any): void {
        const series = getSeries();
        if (!series) return;

        const result = getProfile();
        if (!result) return;

        const { bins: profile, levels } = result;
        const maxVol = Math.max(...profile.map((b) => b.volume));
        if (maxVol === 0) return;

        const showLines = getShowLines();

        target.useBitmapCoordinateSpace((scope: {
          context: CanvasRenderingContext2D;
          bitmapSize: { width: number; height: number };
          horizontalPixelRatio: number;
          verticalPixelRatio: number;
        }) => {
          const { context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio } = scope;
          const W = bitmapSize.width;
          const maxBarW = W * MAX_BAR_WIDTH_FRACTION;

          const toY = (price: number): number | null => {
            const coord = series.priceToCoordinate(price);
            if (coord === null) return null;
            return Math.round(coord * verticalPixelRatio);
          };

          ctx.save();

          // ── 1. Histogram bars ──────────────────────────────────────────────
          for (const bin of profile) {
            const y1 = toY(bin.priceHigh);
            const y2 = toY(bin.priceLow);
            if (y1 === null || y2 === null) continue;

            const top    = Math.min(y1, y2);
            const height = Math.max(1, Math.abs(y2 - y1) - 1);
            const barW   = Math.max(horizontalPixelRatio, (bin.volume / maxVol) * maxBarW);

            if (bin.isPOC) {
              ctx.globalAlpha = 0.92;
              ctx.fillStyle   = '#ff6b35'; // bright orange — POC
            } else if (bin.isVA) {
              ctx.globalAlpha = 0.70;
              ctx.fillStyle   = '#14b8a6'; // teal — Value Area
            } else {
              ctx.globalAlpha = 0.35;
              ctx.fillStyle   = '#64748b'; // slate — outside VA
            }

            ctx.fillRect(W - barW, top, barW, height);
          }

          // ── 2. Horizontal level lines ──────────────────────────────────────
          if (showLines) {
            const pocY = toY(levels.poc);
            const vahY = toY(levels.vah);
            const valY = toY(levels.val);

            ctx.globalAlpha = 1;
            ctx.lineWidth   = 1 * Math.max(horizontalPixelRatio, verticalPixelRatio);

            // VAH — dashed amber
            if (vahY !== null) {
              ctx.strokeStyle = '#fbbf24';
              ctx.setLineDash([6 * horizontalPixelRatio, 4 * horizontalPixelRatio]);
              ctx.beginPath();
              ctx.moveTo(0, vahY);
              ctx.lineTo(W, vahY);
              ctx.stroke();
            }

            // VAL — dashed amber
            if (valY !== null) {
              ctx.strokeStyle = '#fbbf24';
              ctx.setLineDash([6 * horizontalPixelRatio, 4 * horizontalPixelRatio]);
              ctx.beginPath();
              ctx.moveTo(0, valY);
              ctx.lineTo(W, valY);
              ctx.stroke();
            }

            // POC — solid orange (drawn last so it's on top)
            if (pocY !== null) {
              ctx.strokeStyle = '#ff6b35';
              ctx.lineWidth   = 1.5 * Math.max(horizontalPixelRatio, verticalPixelRatio);
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(0, pocY);
              ctx.lineTo(W, pocY);
              ctx.stroke();
            }
          }

          ctx.restore();
        });
      },
    };

    return { renderer: () => paneRenderer };
  }
}
