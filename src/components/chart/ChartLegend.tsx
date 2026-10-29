'use client';

import { useMemo } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/types/market';
import type { IndicatorSeries } from '@/lib/indicators';
import { useChartStore, type ActiveIndicator } from '@/store/chart';
import { formatChartPrice as fmtPrice } from '@/lib/format';

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
  const toggleIndicator = useChartStore((s) => s.toggleIndicator);
  const removeIndicator = useChartStore((s) => s.removeIndicator);

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
      map.set(ai.id, []);
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
        const ai = activeIndicators.find((a) => a.id === indId);
        const isVisible = ai ? ai.visible : true;
        const present = group.filter((s) => seriesValues.has(s.id));

        // Skip indicators that are not overlay indicators and have no present series
        if (!present.length && isVisible) return null;

        return (
          <div
            key={indId}
            className={`group/ind flex items-center gap-x-1.5 text-[10px] font-mono leading-none py-0.5 px-1 -ml-1 rounded transition-colors pointer-events-auto hover:bg-surface-2/80 ${
              !isVisible ? 'opacity-40' : ''
            }`}
          >
            {/* Indicator values */}
            {present.map((s, i) => {
              const val = seriesValues.get(s.id)!;

              let formatted: string;
              if (s.formatValue) {
                formatted = s.formatValue(val);
              } else if (s.panel === 'overlay') {
                formatted = fmtPrice(val);
              } else if (s.seriesType === 'histogram') {
                formatted = (val >= 0 ? '+' : '') + val.toFixed(4);
              } else if (s.id === 'bbpct') {
                formatted = val.toFixed(4);
              } else {
                formatted = val.toFixed(2);
              }

              const isDash = formatted === '—';

              return (
                <span key={s.id} className={`flex items-center gap-x-1 ${isDash ? 'opacity-35' : ''}`}>
                  {i > 0 && <span className="text-text-secondary opacity-40">·</span>}
                  <span style={{ color: s.color }}>{s.name}</span>
                  <span className="text-text-secondary">{formatted}</span>
                </span>
              );
            })}

            {!isVisible && (
              <span className="text-text-muted italic">
                {group[0]?.name ?? indId.toUpperCase()} (hidden)
              </span>
            )}

            {/* Quick action buttons on hover */}
            <div className={`flex items-center gap-1 ml-1.5 transition-opacity ${isVisible ? 'opacity-0 group-hover/ind:opacity-100' : 'opacity-80'}`}>
              {/* Visibility toggle (eye) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleIndicator(indId);
                }}
                className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer"
                title={isVisible ? 'Hide indicator' : 'Show indicator'}
              >
                {isVisible ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                )}
              </button>

              {/* Remove indicator (x) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeIndicator(indId);
                }}
                className="p-0.5 rounded text-text-muted hover:text-rose-400 hover:bg-surface-3 transition-colors cursor-pointer text-[10px] leading-none"
                title="Remove indicator"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}

    </div>
  );
}
