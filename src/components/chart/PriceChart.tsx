'use client';

import {
  useEffect,
  useRef,
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
  /** Called on every crosshair move. x is pixels from left edge of the chart canvas. */
  onCrosshair?: (time: UTCTimestamp | null, x: number | null) => void;
  crosshairTime?: UTCTimestamp | null;
  showTimeAxis?: boolean;
  /** Strategy entry/exit markers painted on the candlestick series. */
  markers?: SeriesMarker<UTCTimestamp>[];
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

/** How many bars to show when switching symbol or timeframe. */
const INITIAL_BARS = 100;

export const PriceChart = forwardRef<PriceChartHandle, Props>(
  function PriceChart({ candles, overlays, contextKey, onCrosshair, crosshairTime, showTimeAxis = true, markers }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const overlayRefs  = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

    const loadedKeyRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      getChart: () => chartRef.current,
      priceToCoordinate: (price) => candleRef.current?.priceToCoordinate(price) ?? null,
      updateCandle: (candle) => {
        if (!candleRef.current) return;
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

      return () => {
        ro.disconnect();
        chart.remove();
        chartRef.current    = null;
        candleRef.current   = null;
        loadedKeyRef.current = null;
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

    // ── Mirror crosshair from other panes ──────────────────────────────────
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || !candleRef.current) return;

      if (!crosshairTime) {
        chart.clearCrosshairPosition();
        return;
      }

      const candle = candleAtTime(candles, crosshairTime);
      if (candle) {
        chart.setCrosshairPosition(candle.close, crosshairTime, candleRef.current);
      }
    }, [crosshairTime, candles]);



    // ── Update candle data ──────────────────────────────────────────────────
    useEffect(() => {
      if (!candleRef.current || candles.length === 0) return;

      const chart        = chartRef.current;
      const isNewContext = loadedKeyRef.current !== contextKey;

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

      if (isNewContext || !savedRange) {
        chart?.priceScale('right').applyOptions({ autoScale: true });
        const total = candles.length;
        chart?.timeScale().setVisibleLogicalRange({
          from: total - INITIAL_BARS - 1,
          to:   total + 3,
        });
        loadedKeyRef.current = contextKey;
      } else {
        chart?.timeScale().setVisibleLogicalRange(savedRange);
      }
    }, [candles, contextKey]);

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

    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: 0 }}
      />
    );
  },
);
