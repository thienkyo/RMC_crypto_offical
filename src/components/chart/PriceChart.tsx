'use client';

import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts';
import { format } from 'date-fns';
import type { Candle } from '@/types/market';
import type { IndicatorSeries } from '@/lib/indicators';
import type { VolumeProfileConfig } from '@/store/chart';
import { VolumeProfileRenderer } from './VolumeProfileRenderer';

export interface PriceChartHandle {
  getChart:    () => IChartApi | null;
  /** Direct series.update() — bypasses React, zero jank on live ticks. */
  updateCandle: (candle: Candle) => void;
  /** Scroll back to the most recent bar (same as pressing "Go to present" in TradingView). */
  scrollToNow: () => void;
  /**
   * Capture the chart canvas as a base64 PNG string (no data-URL prefix).
   * Returns null if the chart is not yet mounted.
   * Used by the Phase 3 AI analysis flow.
   */
  captureScreenshot: () => string | null;
  /**
   * Convert a price value to its Y pixel coordinate within the chart container.
   * Returns null if the chart is not mounted or the price is off-screen.
   * Used to position overlays (e.g. candle countdown timer) aligned to the price axis.
   */
  priceToCoordinate: (price: number) => number | null;
}

interface Props {
  candles:      Candle[];
  overlays:     IndicatorSeries[];
  /** Combined symbol+timeframe key — any change triggers an 80-candle zoom reset. */
  contextKey:   string;
  /**
   * Store's `${symbol}-${timeframe}` stamp for `candles`, or null while the
   * series is cleared. Must equal `contextKey` before we setData / commit the
   * loaded key — otherwise a WS-mutated previous array is treated as fresh.
   */
  dataKey:      string | null;
  /** Called on every crosshair move. x is pixels from left edge of the chart canvas. */
  onCrosshair?: (time: UTCTimestamp | null, x: number | null) => void;
  crosshairTime?: UTCTimestamp | null;
  showTimeAxis?: boolean;
  /** Strategy entry/exit markers painted on the candlestick series. */
  markers?: SeriesMarker<UTCTimestamp>[];
  /**
   * Persisted bar spacing (candle width in px) from the chart store.
   * Applied after the first setData() on mount or context change.
   */
  savedBarSpacing?: number;
  /** Called (debounced) when the user scrolls or zooms, so the new spacing can be persisted. */
  onBarSpacingChange?: (barSpacing: number) => void;
  /** When provided and enabled = true, draws the rolling Volume Profile histogram. */
  vpConfig?: VolumeProfileConfig;
}

/** Binary search for a candle at an exact unix-second timestamp. */
function candleAtTime(candles: Candle[], timeSec: number): Candle | undefined {
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

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * Same-context dirty check. Length + last openTime alone is not enough:
 * BTC and PAXG 1h series often share bar count and aligned last openTime, so
 * a poisoned loadedKey would skip setData for the new symbol. First-bar OHLC
 * changes on a real history swap but stays put on a same-bar live tick.
 */
function isSameRenderedSeries(prev: Candle[] | null, next: Candle[]): boolean {
  if (!prev) return false;
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  if (next.length === 0) return true;
  const prevFirst = prev[0]!;
  const nextFirst = next[0]!;
  const prevLast  = prev[prev.length - 1]!;
  const nextLast  = next[next.length - 1]!;
  return (
    prevFirst.openTime === nextFirst.openTime &&
    prevFirst.open     === nextFirst.open &&
    prevFirst.high     === nextFirst.high &&
    prevFirst.low      === nextFirst.low &&
    prevFirst.close    === nextFirst.close &&
    prevLast.openTime  === nextLast.openTime
  );
}

/** How many bars to show when switching symbol or timeframe. */
const INITIAL_BARS = 100;

export const PriceChart = forwardRef<PriceChartHandle, Props>(
  function PriceChart({ candles, overlays, contextKey, dataKey, onCrosshair, crosshairTime, showTimeAxis = true, markers, savedBarSpacing, onBarSpacingChange, vpConfig }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const overlayRefs  = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
    const vpRendererRef = useRef<VolumeProfileRenderer | null>(null);

    const loadedKeyRef    = useRef<string | null>(null);
    const lastCandlesRef  = useRef<Candle[] | null>(null);
    // Render-phase copy of contextKey so updateCandle() can refuse ticks for a
    // previous symbol before the data effect has reset the LWC series.
    const contextKeyRef   = useRef(contextKey);
    if (contextKeyRef.current !== contextKey) {
      loadedKeyRef.current   = null;
      lastCandlesRef.current = null;
      contextKeyRef.current  = contextKey;
    }

    // ── Bar spacing capture (debounced) ────────────────────────────────────
    // Keep a stable ref to onBarSpacingChange so the LWC subscription never
    // needs to be re-registered when the callback identity changes.
    const onBarSpacingChangeRef = useRef(onBarSpacingChange);
    useEffect(() => { onBarSpacingChangeRef.current = onBarSpacingChange; }, [onBarSpacingChange]);

    const barSpacingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const captureBarSpacing = useCallback(() => {
      const chart = chartRef.current;
      if (!chart) return;
      // LWC exposes barSpacing via timeScale().options()
      const spacing = (chart.timeScale().options() as { barSpacing?: number }).barSpacing;
      if (typeof spacing !== 'number') return;
      if (barSpacingTimerRef.current) clearTimeout(barSpacingTimerRef.current);
      barSpacingTimerRef.current = setTimeout(() => {
        onBarSpacingChangeRef.current?.(spacing);
      }, 600);
    }, []);

    useImperativeHandle(ref, () => ({
      getChart: () => chartRef.current,
      priceToCoordinate: (price) => candleRef.current?.priceToCoordinate(price) ?? null,
      updateCandle: (candle) => {
        if (!candleRef.current) return;
        // History for this context hasn't been setData'd yet — a live tick
        // would land on the previous symbol's series / an empty series.
        if (loadedKeyRef.current !== contextKeyRef.current) return;
        try {
          candleRef.current.update({
            time:  toSec(candle.openTime),
            open:  candle.open,
            high:  candle.high,
            low:   candle.low,
            close: candle.close,
          });
        } catch {
          // Stale WebSocket tick during symbol/timeframe transition — safe to ignore.
        }
      },
      scrollToNow: () => {
        chartRef.current?.timeScale().scrollToRealTime();
      },
      captureScreenshot: () => {
        const chart = chartRef.current;
        if (!chart) return null;
        // takeScreenshot() returns the chart canvas element.
        // toDataURL gives a data-URL; we strip the prefix to get raw base64.
        const canvas = chart.takeScreenshot();
        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl.split(',')[1] ?? null;
      },
    }));

    // ── Initialize chart once ───────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#0a0e1a' },
          textColor:  '#64748b',
          fontSize:   11,
        },
        localization: {
          timeFormatter: (time: number) => format(new Date(time * 1000), 'yyyy-MM-dd HH:mm'),
        },
        grid: {
          vertLines: { color: '#1a2035' },
          horzLines: { color: '#1a2035' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          // Vertical line is suppressed when sub-panes exist (ChartLayout draws a shared one).
          // However, we keep it enabled but sync it via setCrosshairPosition.
          vertLine: { color: '#3b82f6', labelBackgroundColor: '#1e2a3d', visible: showTimeAxis },
          horzLine: { color: '#3b82f6', labelBackgroundColor: '#1e2a3d' },
        },
        rightPriceScale: {
          borderColor: '#1e2a3d',
          minimumWidth: 80,
        },
        timeScale: {
          borderColor:    '#1e2a3d',
          timeVisible:    true,
          secondsVisible: false,
          visible:        showTimeAxis,
          tickMarkFormatter: (time: number, tickMarkType: TickMarkType) => {
            const date = new Date(time * 1000);
            switch (tickMarkType) {
              case TickMarkType.Year:        return format(date, 'yyyy');
              case TickMarkType.Month:       return format(date, 'MMM');
              case TickMarkType.DayOfMonth:  return format(date, 'd');
              case TickMarkType.Time:        return format(date, 'HH:mm');
              case TickMarkType.TimeWithSeconds: return format(date, 'HH:mm:ss');
              default:                       return format(date, 'HH:mm');
            }
          },
        },
        width:  containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor:         '#10b981',
        downColor:       '#ef4444',
        borderUpColor:   '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor:     '#10b981',
        wickDownColor:   '#ef4444',
      });

      chartRef.current  = chart;
      candleRef.current = candleSeries;

      if (onCrosshair) {
        chart.subscribeCrosshairMove((param) => {
          const time = (param.time as UTCTimestamp | undefined) ?? null;
          const x    = param.point?.x ?? null;
          onCrosshair(time, x);
        });
      }

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({
            width:  containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      });
      ro.observe(containerRef.current);

      // Capture bar spacing whenever the user scrolls or zooms
      chart.timeScale().subscribeVisibleLogicalRangeChange(captureBarSpacing);

      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(captureBarSpacing);
        if (barSpacingTimerRef.current) clearTimeout(barSpacingTimerRef.current);
        ro.disconnect();
        chart.remove();
        chartRef.current      = null;
        candleRef.current     = null;
        vpRendererRef.current = null;   // stale primitive — re-attached on next mount
        loadedKeyRef.current  = null;
        overlayRefs.current.clear();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Show/hide time axis ────────────────────────────────────────────────
    useEffect(() => {
      chartRef.current?.applyOptions({
        timeScale: { visible: showTimeAxis },
        crosshair: { vertLine: { visible: showTimeAxis } },
      });
    }, [showTimeAxis]);

    // ── Update candle data ──────────────────────────────────────────────────
    useEffect(() => {
      if (!candleRef.current) return;

      const chart = chartRef.current;
      const isNewContext = loadedKeyRef.current !== contextKey;
      const dataMatchesContext = dataKey === contextKey && candles.length > 0;

      if (isNewContext && !dataMatchesContext) {
        // Context switched and history for the new key is not in the store yet.
        // Clear the series now so a WS tick / leftover OHLC cannot keep the
        // previous symbol's scale. loadedKeyRef was already nulled in render.
        try {
          candleRef.current.setData([]);
        } catch {
          // Series may be mid-teardown during unmount.
        }
        for (const lineSeries of overlayRefs.current.values()) {
          try { lineSeries.setData([]); } catch { /* ignore */ }
        }
        chart?.priceScale('right').applyOptions({ autoScale: true });
        candleRef.current.priceScale().applyOptions({ autoScale: true });
        // ChartLayout keeps the last hover time after the cursor leaves (and
        // after a ticker switch). Drop the painted crosshair so the mirror
        // effect below cannot call setCrosshairPosition on an empty series.
        try {
          chart?.clearCrosshairPosition();
        } catch {
          // Chart may be mid-teardown during unmount.
        }
        return;
      }

      if (!dataMatchesContext) return;

      if (!isNewContext && isSameRenderedSeries(lastCandlesRef.current, candles)) return;

      const rawSavedRange = (!isNewContext && chart)
        ? chart.timeScale().getVisibleLogicalRange()
        : null;

      const savedRange = (rawSavedRange && rawSavedRange.from < candles.length)
        ? rawSavedRange
        : null;

      candleRef.current.setData(
        candles.map((c) => ({
          time:  toSec(c.openTime),
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        })),
      );

      lastCandlesRef.current = candles;

      if (isNewContext || !savedRange) {
        // Force the price scale to recalculate for the new symbol's price range.
        // chart.priceScale() alone doesn't re-trigger if autoScale was already true;
        // calling it on the series' own priceScale() forces LWC to rescale immediately.
        chart?.priceScale('right').applyOptions({ autoScale: true });
        candleRef.current.priceScale().applyOptions({ autoScale: true });
        if (savedBarSpacing) {
          // Restore the user's preferred candle width and scroll to the latest bar.
          // applyOptions({ barSpacing }) keeps the rightmost bar pinned, so we
          // explicitly scroll to real time afterwards to always land on the latest candle.
          chart?.timeScale().applyOptions({ barSpacing: savedBarSpacing });
          chart?.timeScale().scrollToRealTime();
        } else {
          const total = candles.length;
          chart?.timeScale().setVisibleLogicalRange({
            from: total - INITIAL_BARS - 1,
            to:   total + 3,
          });
        }
        loadedKeyRef.current = contextKey;
      } else {
        chart?.timeScale().setVisibleLogicalRange(savedRange);
      }
    }, [candles, contextKey, dataKey, savedBarSpacing]);

    // ── Mirror crosshair from other panes ──────────────────────────────────
    // Runs after the data effect so setData([]) / setData(history) has already
    // landed. ChartLayout keeps the last hover timestamp across ticker switches
    // (and aligned 1h bars can still match via candleAtTime), so we must not
    // call setCrosshairPosition while the series is empty or uncommitted.
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !candleRef.current) return;

      const seriesReady =
        candles.length > 0 &&
        dataKey === contextKey &&
        loadedKeyRef.current === contextKey;

      if (!crosshairTime || !seriesReady) {
        try {
          chart.clearCrosshairPosition();
        } catch {
          // Chart may be mid-teardown during unmount.
        }
        return;
      }

      const candle = candleAtTime(candles, crosshairTime);
      if (!candle) return;

      try {
        chart.setCrosshairPosition(candle.close, crosshairTime, candleRef.current);
      } catch {
        // Lightweight Charts throws "Value is null" if the series was emptied
        // or removed between the guard and this call (mid-teardown).
      }
    }, [crosshairTime, candles, dataKey, contextKey]);

    // ── Render/update overlay indicators ───────────────────────────────────
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      const seen = new Set<string>();

      for (const series of overlays) {
        seen.add(series.id);
        const existing = overlayRefs.current.get(series.id);

        if (existing) {
          existing.setData(
            series.data.map((p) => ({ time: toSec(p.time), value: p.value })),
          );
        } else {
          const lineSeries = chart.addLineSeries({
            color:            series.color,
            lineWidth:        (series.lineWidth ?? 1.5) as 1 | 2 | 3 | 4,
            title:            series.name,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          lineSeries.setData(
            series.data.map((p) => ({ time: toSec(p.time), value: p.value })),
          );
          overlayRefs.current.set(series.id, lineSeries);
        }
      }

      for (const [id, lineSeries] of overlayRefs.current) {
        if (!seen.has(id)) {
          chart.removeSeries(lineSeries);
          overlayRefs.current.delete(id);
        }
      }
    }, [overlays]);

    // ── Strategy markers on the candlestick series ─────────────────────────
    useEffect(() => {
      if (!candleRef.current) return;
      // LWC requires markers sorted ascending by time
      const sorted = [...(markers ?? [])].sort(
        (a, b) => (a.time as number) - (b.time as number),
      );
      try {
        candleRef.current.setMarkers(sorted);
      } catch {
        // Series may be mid-reset during symbol/TF switch — safe to ignore
      }
    }, [markers]);

    // ── Volume Profile primitive ───────────────────────────────────────────
    // Attach/detach the renderer when vpConfig.enabled changes.
    // Update candle data whenever candles or config params change.
    useEffect(() => {
      const series = candleRef.current;
      if (!series) return;

      if (!vpConfig?.enabled) {
        // Remove existing renderer
        if (vpRendererRef.current) {
          try { series.detachPrimitive(vpRendererRef.current); } catch { /* ignore */ }
          vpRendererRef.current = null;
        }
        return;
      }

      if (!vpRendererRef.current) {
        vpRendererRef.current = new VolumeProfileRenderer(vpConfig);
        series.attachPrimitive(vpRendererRef.current);
      } else {
        vpRendererRef.current.setConfig(vpConfig);
      }
      vpRendererRef.current.setCandles(candles);
    }, [vpConfig, candles]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: 0 }}
      />
    );
  },
);
