'use client';

import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
  useMemo,
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
  type MouseEventParams,
} from 'lightweight-charts';
import { format } from 'date-fns';
import type { IndicatorSeries, IndicatorMarker, IndicatorPoint } from '@/lib/indicators';

export interface SubChartHandle {
  getChart: () => IChartApi | null;
  /** Live-tick surgical update — same guard pattern as PriceChart.updateCandle. */
  updateSeriesPoint: (id: string, point: IndicatorPoint) => void;
}

interface Props {
  series:        IndicatorSeries[];
  title:         string;
  /** Signal direction for pattern indicators — renders a colored bull/bear pill. */
  bias?:         'bullish' | 'bearish';
  /** Fixed height in pixels. */
  height:        number;
  /**
   * Crosshair time from the main price chart (unix seconds).
   * When set, the sub-pane legend shows values at this time even when
   * the cursor isn't hovering over this sub-pane directly.
   */
  crosshairTime?: UTCTimestamp | null;
  /**
   * Show the time axis on this pane. Only the bottom-most sub-pane gets true —
   * that single axis is shared visually across all panes. Defaults to false.
   */
  showTimeAxis?: boolean;
  /**
   * Called on every crosshair move in this pane.
   * Mirrors PriceChart's onCrosshair — ChartLayout uses it to drive the shared
   * CSS vertical line and to push the time position to other sub-panes so the
   * date label on the bottom axis stays visible from any pane.
   */
  onCrosshair?: (time: UTCTimestamp | null, x: number | null) => void;
}

const toSec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * Binary search for the value at an exact time (unix ms).
 * Indicator data is sorted oldest→newest, so this is O(log n).
 * Returns undefined if the time isn't found.
 */
function valueAtTime(data: IndicatorPoint[], timeMs: number): number | undefined {
  let lo = 0, hi = data.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t   = data[mid]!.time;
    if (t === timeMs) return data[mid]!.value;
    if (t < timeMs)  lo = mid + 1;
    else             hi = mid - 1;
  }
  return undefined;
}

/** Convert IndicatorMarker[] (unix ms) → SeriesMarker<UTCTimestamp> (unix seconds). */
function toSeriesMarkers(markers: IndicatorMarker[] | undefined): SeriesMarker<UTCTimestamp>[] {
  return (markers ?? []).map((m) => ({
    time:     toSec(m.time),
    position: m.position,
    color:    m.color,
    shape:    m.shape,
    size:     m.size,
    text:     m.text,
  }));
}

/**
 * Generic sub-pane chart for sub-panel indicators (RSI, MACD).
 * Supports both line and histogram series.
 * Time-axis is synchronized externally by ChartLayout via the ref handle.
 *
 * Crosshair legend: each series value is shown in the pane header as the
 * cursor moves. Values disappear when the cursor leaves the chart.
 */
export const SubChart = forwardRef<SubChartHandle, Props>(
  function SubChart({ series, title, bias, height, crosshairTime, showTimeAxis = false, onCrosshair }, ref) {
    const containerRef    = useRef<HTMLDivElement>(null);
    const chartRef        = useRef<IChartApi | null>(null);
    const seriesRefs      = useRef<Map<string, ISeriesApi<'Line' | 'Histogram'>>>(new Map());
    // Stable ref so handleCrosshair (subscribed once) always calls the latest prop.
    const onCrosshairRef  = useRef(onCrosshair);
    useEffect(() => { onCrosshairRef.current = onCrosshair; }, [onCrosshair]);

    // Crosshair legend: map of series-id → current hovered value (from this pane's own crosshair)
    const [hovered, setHovered] = useState<Record<string, number>>({});

    // Values resolved from the main chart's crosshair time — used when the cursor
    // is on the price chart rather than this sub-pane.
    const externalValues = useMemo<Record<string, number>>(() => {
      if (!crosshairTime) return {};
      const timeMs = crosshairTime * 1000; // UTCTimestamp (seconds) → ms
      const vals: Record<string, number> = {};
      for (const s of series) {
        const v = valueAtTime(s.data, timeMs);
        if (v !== undefined) vals[s.id] = v;
      }
      return vals;
    }, [crosshairTime, series]);

    // Own crosshair takes priority (cursor is directly on this pane).
    // Fall back to externalValues when cursor is elsewhere on the chart.
    const displayValues = Object.keys(hovered).length > 0 ? hovered : externalValues;

    useImperativeHandle(ref, () => ({
      getChart: () => chartRef.current,
      updateSeriesPoint: (id: string, point: IndicatorPoint) => {
        const ser = seriesRefs.current.get(id);
        if (!ser) return;
        try {
          ser.update({
            time:  toSec(point.time),
            value: point.value,
            ...(point.color ? { color: point.color } : {}),
          });
        } catch {
          // A stale WebSocket tick arrived during a symbol/timeframe transition
          // (series was reset via setData before this update landed).
          // Safe to ignore — the next full setData cycle will correct the data.
        }
      },
    }));

    // ── Crosshair handler (stable ref so it can be used inside init effect) ──
    const handleCrosshair = useCallback((param: MouseEventParams) => {
      const time = (param.time as UTCTimestamp | undefined) ?? null;
      const x    = param.point?.x ?? null;

      // Bubble up to ChartLayout so it can update the shared CSS vertical line
      // and mirror crosshair position to other panes (date label on bottom axis).
      onCrosshairRef.current?.(time, x);

      // param.point is undefined when the cursor leaves the pane
      if (!param.point || !param.time) {
        setHovered({});
        return;
      }

      const vals: Record<string, number> = {};
      for (const [id, ser] of seriesRefs.current) {
        const entry = param.seriesData.get(ser);
        if (entry !== undefined && 'value' in entry) {
          vals[id] = (entry as { value: number }).value;
        }
      }
      setHovered(vals);
    }, []);

    // ── Initialize chart ───────────────────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current) return;

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#0a0e1a' },
          textColor:  '#64748b',
          fontSize:   10,
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
          // Vertical line is suppressed except on the pane with the time axis.
          // This allows the date label to show at the bottom while ChartLayout
          // handles the full-height visual dashed line.
          vertLine: {
            visible:      showTimeAxis,
            labelVisible: showTimeAxis,
            color:        '#3b82f6',
            labelBackgroundColor: '#1e2a3d',
          },
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
        height,
      });

      chartRef.current = chart;

      chart.subscribeCrosshairMove(handleCrosshair);

      const ro = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
        chart.unsubscribeCrosshairMove(handleCrosshair);
        chart.remove();
        chartRef.current = null;
        seriesRefs.current.clear();
        setHovered({});
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sync height prop ───────────────────────────────────────────────────
    useEffect(() => {
      chartRef.current?.applyOptions({ height });
    }, [height]);

    // ── Show/hide time axis ────────────────────────────────────────────────
    useEffect(() => {
      chartRef.current?.applyOptions({
        timeScale: { visible: showTimeAxis },
        crosshair: { vertLine: { visible: showTimeAxis, labelVisible: showTimeAxis } },
      });
    }, [showTimeAxis]);

    // ── Mirror main-chart crosshair into this pane ─────────────────────────
    // When the cursor is on the price chart (not this sub-pane), crosshairTime
    // is the hovered bar's unix-second timestamp.  We call setCrosshairPosition
    // so LWC draws the same vertical (and horizontal) crosshair line here too.
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      if (!crosshairTime) {
        chart.clearCrosshairPosition();
        return;
      }

      const timeMs = crosshairTime * 1000; // back to unix ms for valueAtTime()

      // Find the first line series that has data at this bar.
      // The price value positions the horizontal crosshair line in the sub-pane.
      for (const s of series) {
        if (s.seriesType !== 'line') continue;
        const ser = seriesRefs.current.get(s.id);
        if (!ser) continue;
        const val = valueAtTime(s.data, timeMs);
        if (val !== undefined) {
          chart.setCrosshairPosition(val, crosshairTime, ser);
          return;
        }
      }
      // Histogram-only pane (e.g. pure MACD hist) — fall back to first series
      for (const s of series) {
        const ser = seriesRefs.current.get(s.id);
        if (!ser) continue;
        const val = valueAtTime(s.data, timeMs);
        if (val !== undefined) {
          chart.setCrosshairPosition(val, crosshairTime, ser);
          return;
        }
      }
    }, [crosshairTime, series]);

    // ── Render/update series ───────────────────────────────────────────────
    useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;

      const seen = new Set<string>();

      for (const s of series) {
        seen.add(s.id);
        const existing = seriesRefs.current.get(s.id);

        if (s.seriesType === 'histogram') {
          let histData = s.data.map((p) => {
            const timeVal = toSec(p.time);
            if (Number.isNaN(p.value)) return { time: timeVal } as any;
            return {
              time:  timeVal,
              value: p.value,
              color: p.color,
            };
          });
          
          const badPoints = histData.filter((p: any) => Number.isNaN(p.time) || p.time === undefined);
          if (badPoints.length > 0) {
            console.error(`[SubChart] NaN time detected in histogram series ${s.id}.`);
            console.error(`Raw indicator data slice:`, JSON.stringify(s.data.filter(p => Number.isNaN(toSec(p.time)) || p.time === undefined).slice(0, 5)));
            histData = histData.filter((p: any) => !Number.isNaN(p.time) && p.time !== undefined);
          }

          if (existing) {
            const hist = existing as ISeriesApi<'Histogram'>;
            hist.setData(histData);
            hist.setMarkers(toSeriesMarkers(s.markers));
          } else {
            const hist = chart.addHistogramSeries({
              color:            s.color,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            hist.setData(histData);
            hist.setMarkers(toSeriesMarkers(s.markers));
            seriesRefs.current.set(s.id, hist);
          }
        } else {
          // line
          let lineData = s.data.map((p) => {
            const timeVal = toSec(p.time);
            if (Number.isNaN(p.value)) return { time: timeVal } as any;
            return { time: timeVal, value: p.value };
          });
          
          const badPoints = lineData.filter((p: any) => Number.isNaN(p.time) || p.time === undefined);
          if (badPoints.length > 0) {
            console.error(`[SubChart] NaN time detected in line series ${s.id}.`);
            console.error(`Raw indicator data slice:`, JSON.stringify(s.data.filter(p => Number.isNaN(toSec(p.time)) || p.time === undefined).slice(0, 5)));
            lineData = lineData.filter((p: any) => !Number.isNaN(p.time) && p.time !== undefined);
          }

          if (existing) {
            const line = existing as ISeriesApi<'Line'>;
            line.setData(lineData);
            line.setMarkers(toSeriesMarkers(s.markers));
          } else {
            const line = chart.addLineSeries({
              color:            s.color,
              lineWidth:        (s.lineWidth ?? 1.5) as 1 | 2 | 3 | 4,
              title:            s.name,
              priceLineVisible: false,
              lastValueVisible: false,
            });
            line.setData(lineData);
            line.setMarkers(toSeriesMarkers(s.markers));
            seriesRefs.current.set(s.id, line);
          }
        }
      }

      // Remove stale series
      for (const [id, ser] of seriesRefs.current) {
        if (!seen.has(id)) {
          chart.removeSeries(ser);
          seriesRefs.current.delete(id);
        }
      }
    }, [series]);

    return (
      <div className="relative w-full">
        {/* ── Pane legend ─────────────────────────────────────────────────── */}
        <div className="absolute top-1 left-2 z-10 flex items-center gap-3 select-none pointer-events-none">
          {/* Title */}
          <span className="text-[10px] font-mono text-text-secondary">
            {title}
          </span>

          {/* Bias pill — bullish/bearish tag for pattern indicators */}
          {bias && (
            <span
              className={`text-[9px] font-mono font-medium px-1 py-px rounded flex-shrink-0
                ${bias === 'bullish' ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}
            >
              {bias === 'bullish' ? '▲ Bullish' : '▼ Bearish'}
            </span>
          )}

          {/* Per-series values — shown while crosshair is active on any pane */}
          {series.map((s) => {
            const val = displayValues[s.id];
            if (val === undefined) return null;

            // Format: histogram (MACD hist) gets a sign prefix; lines get plain decimals
            const formatted = s.seriesType === 'histogram'
              ? (val >= 0 ? '+' : '') + val.toFixed(4)
              : val.toFixed(2);

            return (
              <span
                key={s.id}
                className="text-[10px] font-mono"
                style={{ color: s.color }}
              >
                {s.name}&nbsp;{formatted}
              </span>
            );
          })}
        </div>

        <div
          ref={containerRef}
          className="w-full"
          style={{ height, minHeight: 0 }}
        />
      </div>
    );
  },
);
