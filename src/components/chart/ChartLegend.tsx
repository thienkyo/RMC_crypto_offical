'use client';

import { useMemo } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/types/market';
import type { IndicatorSeries } from '@/lib/indicators';
import type { ActiveIndicator } from '@/store/chart';

interface Props {
  candles:          Candle[];
  /** Unix-second timestamp from LWC crosshair (null = no hover yet). */
  crosshairTime:    UTCTimestamp | null;
  allSeries:        IndicatorSeries[];
  activeIndicators: ActiveIndicator[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findCandle(candles: Candle[], timeSec: number): Candle | undefined {
  let lo = 0, hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t   = Math.floor(candles[mid]!.openTime / 1000);
    if (t === timeSec) return candles[mid];
    if (t < timeSec)  lo = mid + 1;
    else              hi = mid - 1;
  }
  return undefined;
}

function findSeriesValue(
  data: { time: number; value: number }[],
  timeMs: number,
): number | undefined {
  let lo = 0, hi = data.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t   = data[mid]!.time;
    if (t === timeMs) {
      const v = data[mid]!.value;
      return Number.isNaN(v) ? undefined : v;
    }
    if (t < timeMs) lo = mid + 1;
    else            hi = mid - 1;
  }
  return undefined;
}

function fmtPrice(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: v < 1 ? 6 : 2,
  });
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1)     + 'K';
  return v.toFixed(2);
}

/**
 * Map a computed series ID back to the indicator that produced it.
 * Covers dynamic IDs (ema_20, rsi_14) and fixed multi-series (bb_*, macd_*).
 */
function resolveIndicatorId(seriesId: string, indicators: ActiveIndicator[]): string {
  // Try direct prefix match first (covers ema_N, rsi_N, rsi_ema_N, bbpct)
  for (const ai of indicators) {
    if (seriesId.startsWith(ai.id)) return ai.id;
  }
  // Bollinger series: bb_upper / bb_middle / bb_lower
  if (seriesId.startsWith('bb_'))    return 'bollinger';
  // MACD series: macd_line / macd_signal / macd_hist
  if (seriesId.startsWith('macd_'))  return 'macd';
  return seriesId;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * TradingView-style OHLCV + indicator legend overlaid in the top-left of the
 * price chart.  Always shows the last bar; updates to the hovered bar as the
 * cursor moves over any chart pane.
 */
export function ChartLegend({ candles, crosshairTime, allSeries, activeIndicators }: Props) {
  // Which candle to display — hovered bar or latest bar
  const candle = useMemo(() => {
    if (!candles.length) return undefined;
    if (crosshairTime !== null) {
      return findCandle(candles, crosshairTime) ?? candles[candles.length - 1];
    }
    return candles[candles.length - 1];
  }, [candles, crosshairTime]);

  // Resolved indicator values at that candle
  const seriesValues = useMemo(() => {
    if (!candle) return new Map<string, number>();
    const timeMs = candle.openTime;
    const vals   = new Map<string, number>();
    for (const s of allSeries) {
      const v = findSeriesValue(s.data, timeMs);
      if (v !== undefined) vals.set(s.id, v);
    }
    return vals;
  }, [candle, allSeries]);

  // Group series by indicator, preserving activeIndicators order
  const indicatorGroups = useMemo(() => {
    const map = new Map<string, IndicatorSeries[]>();
    for (const ai of activeIndicators) {
      if (ai.visible) map.set(ai.id, []);
    }
    for (const s of allSeries) {
      const indId = resolveIndicatorId(s.id, activeIndicators);
      if (!map.has(indId)) map.set(indId, []);
      map.get(indId)!.push(s);
    }
    return map;
  }, [allSeries, activeIndicators]);

  if (!candle) return null;

  const isUp       = candle.close >= candle.open;
  const priceColor = isUp ? '#10b981' : '#ef4444';

  return (
    <div className="absolute top-1.5 left-2 z-10 flex flex-col gap-0.5 select-none pointer-events-none">

      {/* ── OHLCV ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-x-2 text-[10px] font-mono leading-none">
        <span className="text-text-secondary">O</span>
        <span style={{ color: priceColor }}>{fmtPrice(candle.open)}</span>
        <span className="text-text-secondary">H</span>
        <span style={{ color: priceColor }}>{fmtPrice(candle.high)}</span>
        <span className="text-text-secondary">L</span>
        <span style={{ color: priceColor }}>{fmtPrice(candle.low)}</span>
        <span className="text-text-secondary">C</span>
        <span style={{ color: priceColor }}>{fmtPrice(candle.close)}</span>
        <span className="text-[9px] text-text-secondary ml-1">Vol</span>
        <span className="text-[9px] text-text-muted">{fmtVol(candle.volume)}</span>
      </div>

      {/* ── Indicator rows — one row per active indicator ───────────────── */}
      {Array.from(indicatorGroups.entries()).map(([indId, group]) => {
        // Only show series that have a value at this bar
        const present = group.filter((s) => seriesValues.has(s.id));
        if (!present.length) return null;

        return (
          <div key={indId} className="flex items-center gap-x-1.5 text-[10px] font-mono leading-none">
            {present.map((s, i) => {
              const val = seriesValues.get(s.id)!;

              let formatted: string;
              if (s.panel === 'overlay') {
                // Price-scale series (EMA, BB bands) — same decimal format as price
                formatted = fmtPrice(val);
              } else if (s.seriesType === 'histogram') {
                formatted = (val >= 0 ? '+' : '') + val.toFixed(4);
              } else if (s.id === 'bbpct') {
                // %B oscillator — show 4 decimals so 1.0000 / 0.0000 extremes are clear
                formatted = val.toFixed(4);
              } else {
                formatted = val.toFixed(2);
              }

              return (
                <span key={s.id} className="flex items-center gap-x-1">
                  {i > 0 && <span className="text-text-secondary opacity-40">·</span>}
                  <span style={{ color: s.color }}>{s.name}</span>
                  <span className="text-text-secondary">{formatted}</span>
                </span>
              );
            })}
          </div>
        );
      })}

    </div>
  );
}
