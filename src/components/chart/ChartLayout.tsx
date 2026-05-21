'use client';

import { useRef, useMemo, useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LogicalRange, IChartApi, Logical, SeriesMarker, UTCTimestamp as LWCTimestamp } from 'lightweight-charts';
import { format } from 'date-fns';
import { useChartStore } from '@/store/chart';
import { useStrategyStore } from '@/store/strategy';
import { useLayoutStore } from '@/store/layout';
import { useCandles }    from '@/hooks/useCandles';
import { subscribeKline } from '@/lib/exchange/binance';
import { INDICATORS }    from '@/lib/indicators';
import type { IndicatorSeries, IndicatorPoint, IndicatorMarker } from '@/lib/indicators';
import { useLiveStrategies } from '@/hooks/useLiveStrategy';
import { computeSignalCandles } from '@/lib/strategy/signals';
import { PriceChart, type PriceChartHandle } from './PriceChart';
import { SubChart,   type SubChartHandle   } from './SubChart';
import { CandleTimer, CandleTimerInline }       from './CandleTimer';
import { ChartLegend }                       from './ChartLegend';
import { TimeframeSelector } from '../ui/TimeframeSelector';
import { IndicatorSelector } from '../ui/IndicatorSelector';
import { StaleDataBanner }   from '../ui/StaleDataBanner';
import type { Candle } from '@/types/market';

// ─── Pane resize handle ───────────────────────────────────────────────────────

const SUB_HEIGHT_MIN = 60;
const SUB_HEIGHT_MAX = 500;
const SUB_HEIGHT_DEFAULT: Record<string, number> = {
  macd: 140,
  // all others fall through to 120
};
const SUB_HEIGHT_FALLBACK = 120;

/**
 * Thin drag strip rendered at the top of each sub-pane.
 * Dragging up → pane grows; dragging down → pane shrinks.
 */
function PaneResizer({ onDelta }: { onDelta: (delta: number) => void }) {
  const isDragging = useRef(false);
  const lastY      = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    lastY.current = e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = lastY.current - ev.clientY; // up = positive = grow
      lastY.current = ev.clientY;
      onDelta(delta);
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [onDelta]);

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-full h-1.5 cursor-ns-resize flex-shrink-0 group relative z-10
                 border-t border-surface-border
                 hover:border-accent/60 active:border-accent transition-colors"
      title="Drag to resize"
    >
      {/* Visual grab indicator — only shows on hover */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 mx-auto w-10
                      rounded-full bg-surface-border group-hover:bg-accent/50
                      group-active:bg-accent transition-colors" />
    </div>
  );
}

// ─── Main layout ──────────────────────────────────────────────────────────────

interface ChartLayoutProps {
  /**
   * Called once after the chart mounts with a function that captures the
   * current price chart canvas as a base64 PNG.  Used by AnalysisPanel to
   * feed screenshots to the Phase 3 AI analysis API.
   */
  onCaptureMounted?: (capture: () => string | null) => void;
}

export function ChartLayout({ onCaptureMounted }: ChartLayoutProps) {
  // Use individual selectors instead of useChartStore() (whole-store) to avoid
  // re-rendering on every tick.  With no selector, any set() call — including
  // lastTickAt: Date.now() on every WebSocket tick — creates a new state object
  // and forces a re-render.  Per-field selectors only re-render when that specific
  // field changes.
  const candles          = useChartStore((s) => s.candles);
  const activeIndicators = useChartStore((s) => s.activeIndicators);
  const isStale          = useChartStore((s) => s.isStale);
  const setStale         = useChartStore((s) => s.setStale);
  const symbol           = useChartStore((s) => s.symbol);
  const timeframe        = useChartStore((s) => s.timeframe);
  const updateLastCandle = useChartStore((s) => s.updateLastCandle);
  const { isLoading, error } = useCandles();
  const toggleStrategyActive = useStrategyStore((s) => s.toggleStrategyActive);
  const setActiveStrategy    = useStrategyStore((s) => s.setActiveStrategy);
  const allStrategies        = useStrategyStore((s) => s.strategies);
  const router = useRouter();

  const { leftRailVisible, rightRailVisible, toggleLeft, toggleRight } = useLayoutStore();

  // ── Strategy chip visibility ───────────────────────────────────────────────
  // Chips show for every strategy matching this chart's symbol+timeframe.
  // ⏻ toggles active state (chip stays, just dims).
  // X dismisses the chip for this session; cleared when symbol/TF changes.
  const [dismissedChipIds, setDismissedChipIds] = useState<Set<string>>(new Set());
  // IDs of chips whose tooltip is currently pinned open (click to pin, click outside to close all).
  const [pinnedChipIds, setPinnedChipIds] = useState<Set<string>>(new Set());
  const chipsRef = useRef<HTMLDivElement>(null);
  // Signal strip — visible by default, toggled by the "Signals N" button
  const [stripVisible, setStripVisible] = useState(true);

  // Reset dismissals + pins whenever the chart context changes
  useEffect(() => {
    setDismissedChipIds(new Set());
    setPinnedChipIds(new Set());
  }, [symbol, timeframe]);

  // Click outside chips area → close all pinned tooltips
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (chipsRef.current && !chipsRef.current.contains(e.target as Node)) {
        setPinnedChipIds(new Set());
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function togglePin(id: string) {
    setPinnedChipIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function dismissChip(id: string) {
    setDismissedChipIds((prev) => new Set([...prev, id]));
    setPinnedChipIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  // All non-template strategies for this chart that haven't been dismissed.
  // Templates are blueprints only — they never appear as active chart chips.
  const chartStrategies = useMemo(
    () =>
      allStrategies.filter(
        (s) =>
          !s.isTemplate &&
          s.symbol === symbol &&
          s.timeframe === timeframe &&
          !dismissedChipIds.has(s.id),
      ),
    [allStrategies, symbol, timeframe, dismissedChipIds],
  );

  const priceRef = useRef<PriceChartHandle>(null);
  const subRefs  = useRef<Map<string, SubChartHandle>>(new Map());

  // ── Sub-pane heights (resizable via drag) ─────────────────────────────────
  const [subHeights, setSubHeights] = useState<Record<string, number>>({});

  const getSubHeight = useCallback((id: string) =>
    subHeights[id] ?? SUB_HEIGHT_DEFAULT[id] ?? SUB_HEIGHT_FALLBACK,
  [subHeights]);

  const handlePaneDelta = useCallback((id: string, delta: number) => {
    setSubHeights((prev) => ({
      ...prev,
      [id]: Math.max(
        SUB_HEIGHT_MIN,
        Math.min(SUB_HEIGHT_MAX, (prev[id] ?? SUB_HEIGHT_DEFAULT[id] ?? SUB_HEIGHT_FALLBACK) + delta),
      ),
    }));
  }, []);

  // Last live tick stored here (not in Zustand candles) so the header price
  // updates without triggering a full candles→setData() re-render cycle.
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // Crosshair time from the main price chart — shared with sub-panes so their
  // legends stay live even when the cursor is on the price chart, not the sub-pane.
  const [crosshairTime, setCrosshairTime] = useState<import('lightweight-charts').UTCTimestamp | null>(null);
  const [crosshairX,    setCrosshairX]    = useState<number | null>(null);

  const handleCrosshair = useCallback(
    (time: import('lightweight-charts').UTCTimestamp | null, x: number | null) => {
      // Only update crosshairTime when the cursor is actually on a bar.
      // When it leaves (time = null) we intentionally keep the last value so
      // sub-pane legends stay visible rather than blinking off — same UX as
      // TradingView where the legend shows the last-hovered bar until a new
      // one is selected.
      if (time !== null) setCrosshairTime(time);
      // x drives the CSS vertical line; null clears it when cursor leaves.
      setCrosshairX(x);
    },
    [],
  );
  const lastTickRef = useRef<number>(Date.now());
  const candlesRef  = useRef<Candle[]>([]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);

  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);

  // ── Live tick subscription ──────────────────────────────────────────────
  useEffect(() => {
    lastTickRef.current = Date.now();
    setLivePrice(null);
    setLiveCandle(null);

    const unsubscribe = subscribeKline(
      symbol,
      timeframe,
      (candle: Candle) => {
        lastTickRef.current = Date.now();
        setStale(false);

        // 1. Surgical indicator updates (Sub-charts FIRST to prevent TimeScale clamping)
        const currentCandles = candlesRef.current;
        if (currentCandles.length > 0) {
          const last = currentCandles[currentCandles.length - 1]!;
          const merged = (candle.openTime === last.openTime)
            ? [...currentCandles.slice(0, -1), candle]
            : [...currentCandles, candle];

          for (const ai of activeIndicators) {
            if (!ai.visible) continue;
            const indicator = INDICATORS[ai.id];
            if (!indicator) continue;

            const subChart = subRefs.current.get(ai.id);
            if (!subChart) continue;

            try {
              const latestResults = indicator.compute(merged, ai.params);
              for (const res of latestResults) {
                const lastPoint = res.data[res.data.length - 1];
                if (lastPoint) {
                  subChart.updateSeriesPoint(res.id, lastPoint);
                }
              }
            } catch (err) {
              console.error(`[surgical-indicator:${ai.id}] failed:`, err);
            }
          }
        }

        // 2. Direct price update (Main chart SECOND)
        priceRef.current?.updateCandle(candle);
        setLivePrice(candle.close);
        setLiveCandle(candle);

        // 3. Update store (eventual consistency)
        updateLastCandle(candle);
      },
      () => setStale(true),
    );

    // Stale detection
    const STALE_MS: Record<string, number> = {
      '1m': 90_000, '3m': 200_000, '5m': 350_000,
    };
    const threshold = STALE_MS[timeframe] ?? 5 * 60_000;
    const staleTimer = setInterval(() => {
      if (Date.now() - lastTickRef.current > threshold) setStale(true);
    }, 10_000);

    return () => {
      unsubscribe();
      clearInterval(staleTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  // ── Compute indicator series ───────────────────────────────────────────────
  const allSeries: IndicatorSeries[] = useMemo(() => {
    if (candles.length === 0) return [];

    // Merge liveCandle into candles for computation to ensure indicators
    // reach the absolute end of the chart in real-time.
    let merged = candles;
    if (liveCandle) {
      const last = candles[candles.length - 1];
      if (last && last.openTime === liveCandle.openTime) {
        merged = [...candles.slice(0, -1), liveCandle];
      } else if (last && liveCandle.openTime > last.openTime) {
        merged = [...candles, liveCandle];
      }
    }

    const result: IndicatorSeries[] = [];
    for (const ai of activeIndicators) {
      if (!ai.visible) continue;
      const indicator = INDICATORS[ai.id];
      if (!indicator) continue;
      try {
        const computed = indicator.compute(merged, ai.params);
        
        // Pad with WhitespaceData (NaN) so logical indices match perfectly
        for (const s of computed) {
          if (s.data.length > 0 && s.data.length < merged.length) {
            const missingCount = merged.length - s.data.length;
            const pad: IndicatorPoint[] = [];
            for (let i = 0; i < missingCount; i++) {
              pad.push({ time: merged[i]!.openTime, value: NaN });
            }
            s.data = [...pad, ...s.data];
          }
        }
        
        result.push(...computed);
      } catch (err) {
        console.error(`[indicator:${ai.id}] compute failed:`, err);
      }
    }
    return result;
  }, [candles, liveCandle, activeIndicators]);

  const overlaySeries = useMemo(
    () => allSeries.filter((s) => s.panel === 'overlay'),
    [allSeries],
  );

  const subPaneGroups = useMemo(() => {
    const groups = new Map<string, IndicatorSeries[]>();
    for (const s of allSeries.filter((s) => s.panel === 'sub')) {
      const indicatorId = activeIndicators.find((ai) => s.id.startsWith(ai.id))?.id ?? s.id;
      // Pattern indicators (bias set) render only as arrow markers on the price chart —
      // no sub-pane needed; the histogram signal data is irrelevant for display.
      if (INDICATORS[indicatorId]?.bias !== undefined) continue;
      if (!groups.has(indicatorId)) groups.set(indicatorId, []);
      groups.get(indicatorId)!.push(s);
    }
    return groups;
  }, [allSeries, activeIndicators]);

  // ── Time-axis synchronization across panes (bidirectional) ───────────────
  //
  // All panes drag together.  We use *logical-index* ranges, not time ranges,
  // to avoid LWC async-callback feedback loops that occur with setVisibleRange.
  // The slight index offset between data arrays (RSI warmup = 14 bars, MACD = 25)
  // is imperceptible in an 80-bar window.
  const isSyncing = useRef(false);

  /**
   * Apply `range` to every pane except `sourceChart`.
   * The isSyncing guard prevents loops: setVisibleLogicalRange on chart B fires
   * B's listener synchronously, which would recurse — the guard drops it.
   */
  const syncFromChart = useCallback((sourceChart: IChartApi, range: LogicalRange) => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    const mainChart = priceRef.current?.getChart();
    if (mainChart && mainChart !== sourceChart) {
      mainChart.timeScale().setVisibleLogicalRange(range);
    }
    for (const [, handle] of subRefs.current) {
      const chart = handle.getChart();
      if (chart && chart !== sourceChart) {
        chart.timeScale().setVisibleLogicalRange(range);
      }
    }

    isSyncing.current = false;
  }, []);

  // Price chart → all sub-panes.
  useEffect(() => {
    const mainChart = priceRef.current?.getChart();
    if (!mainChart) return;
    const handler = (range: LogicalRange | null) => {
      if (range) syncFromChart(mainChart, range);
    };
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length, syncFromChart]);

  // Sub-panes → price chart + other sub-panes (bidirectional).
  // rAF defers one frame so SubChart's init effect has run and getChart() is set.
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    const raf = requestAnimationFrame(() => {
      for (const [, handle] of subRefs.current) {
        const chart = handle.getChart();
        if (!chart) continue;
        const handler = (range: LogicalRange | null) => {
          if (range) syncFromChart(chart, range);
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
        unsubs.push(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler));
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      unsubs.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPaneGroups, syncFromChart]);

  // ── Register screenshot capture with parent (Phase 3) ────────────────────
  // Runs once after mount.  priceRef.current is set by the time the
  // PriceChart effect runs, but we schedule via rAF to be safe.
  useEffect(() => {
    if (!onCaptureMounted) return;
    const raf = requestAnimationFrame(() => {
      onCaptureMounted(() => priceRef.current?.captureScreenshot() ?? null);
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live strategy monitor ─────────────────────────────────────────────────
  // Distinct colors per strategy slot — used for header chips and drop-line labels.
  // Marker arrow/circle colors stay green/red (direction semantics).
  const STRATEGY_COLORS = ['#3b82f6', '#f59e0b', '#a855f7', '#06b6d4', '#f97316', '#ec4899'] as const;

  const liveStrategies = useLiveStrategies();

  // ── Marker visibility controls ────────────────────────────────────────────
  const [markerVisibility, setMarkerVisibility] = useState({
    rawSignals:   true,  // amber squares — every candle entry conditions fired
    tradeEntries: true,  // arrows — backtest trade entries
    tradeExits:   true,  // circles — backtest trade exits with P&L
    patterns:     true,  // arrows — candlestick pattern detections
    dropLines:    true,  // vertical lines + name labels at the bottom of the price pane
  });
  // When false, strategy name labels are stripped from marker text (arrows/circles
  // still render — only the text overlay is suppressed).
  const [showMarkerLabels, setShowMarkerLabels] = useState(true);
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const markerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (markerMenuRef.current && !markerMenuRef.current.contains(e.target as Node)) {
        setMarkerMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function toggleMarker(key: keyof typeof markerVisibility) {
    setMarkerVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Marker category metadata — descriptions shown in the popover
  const MARKER_CATEGORIES: Array<{
    key:   keyof typeof markerVisibility;
    label: string;
    desc:  string;
    color: string;
    shape: string; // display glyph in the popover
  }> = [
    {
      key:   'rawSignals',
      label: 'Signal candles',
      desc:  'Every candle where all entry conditions fired. These are the exact candles that would trigger a Telegram alert — independent of position management.',
      color: '#fbbf24',
      shape: '■',
    },
    {
      key:   'tradeEntries',
      label: 'Trade entries',
      desc:  'Backtest trade entry points after position management (SL/TP, one-at-a-time). ▲ = long entry, ▼ = short entry.',
      color: '#10b981',
      shape: '▲',
    },
    {
      key:   'tradeExits',
      label: 'Trade exits',
      desc:  'Backtest trade exits. Shows the strategy label and realised P&L %. Green = profit, red = loss.',
      color: '#94a3b8',
      shape: '●',
    },
    {
      key:   'patterns',
      label: 'Candlestick patterns',
      desc:  'Pattern detections from active pattern indicators (Engulfing, Hammer, Shooting Star, Three White Soldiers, etc.).',
      color: '#a78bfa',
      shape: '▲',
    },
    {
      key:   'dropLines',
      label: 'Drop-lines',
      desc:  'Vertical lines + strategy name labels drawn at the bottom of the price pane for every trade entry/exit timestamp.',
      color: '#3b82f6',
      shape: '▏',
    },
  ];

  // ── Categorised strategy markers ─────────────────────────────────────────
  // Split into three separate arrays so each category can be toggled independently.
  const { rawSignalMarkers, tradeEntryMarkers, tradeExitMarkers } =
    useMemo(() => {
      const raw:     SeriesMarker<LWCTimestamp>[] = [];
      const entries: SeriesMarker<LWCTimestamp>[] = [];
      const exits:   SeriesMarker<LWCTimestamp>[] = [];

      if (liveStrategies.length === 0) return { rawSignalMarkers: raw, tradeEntryMarkers: entries, tradeExitMarkers: exits };

      for (let idx = 0; idx < liveStrategies.length; idx++) {
        const { strategy, trades } = liveStrategies[idx]!;
        const label = (strategy.name.split(' ')[0] ?? 'S').slice(0, 4).toUpperCase();

        // Raw condition-signal markers — amber squares
        const rawSignals = computeSignalCandles(strategy, candles);
        for (const signal of rawSignals) {
          const isLong = signal.direction === 'long';
          raw.push({
            time:     Math.floor(signal.openTimeMs / 1000) as LWCTimestamp,
            position: isLong ? 'belowBar' : 'aboveBar',
            color:    '#fbbf24',
            shape:    'square',
            text:     '',
            size:     1,
          });
        }

        // Backtest entry/exit markers
        for (const trade of trades) {
          const isLong = trade.direction === 'long';
          entries.push({
            time:     Math.floor(trade.entryTime / 1000) as LWCTimestamp,
            position: isLong ? 'belowBar' : 'aboveBar',
            color:    isLong ? '#10b981' : '#ef4444',
            shape:    isLong ? 'arrowUp' : 'arrowDown',
            text:     showMarkerLabels ? `${label} ${isLong ? '▲' : '▼'}` : '',
            size:     2,
          });
          if (trade.exitReason !== 'end_of_data') {
            exits.push({
              time:     Math.floor(trade.exitTime / 1000) as LWCTimestamp,
              position: isLong ? 'aboveBar' : 'belowBar',
              color:    trade.pnlPct >= 0 ? '#10b981' : '#ef4444',
              shape:    'circle',
              text:     showMarkerLabels ? `${label} ${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%` : '',
              size:     1,
            });
          }
        }
      }
      return { rawSignalMarkers: raw, tradeEntryMarkers: entries, tradeExitMarkers: exits };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveStrategies, candles, showMarkerLabels]);

  // ── Pattern markers on price chart ───────────────────────────────────────
  // Extract IndicatorMarker[] from any indicator series that carries them
  // (pattern detectors) and convert to LWC SeriesMarker format so they render
  // as arrows directly on the price chart — same layer as strategy markers.
  const patternMarkers = useMemo((): SeriesMarker<LWCTimestamp>[] => {
    const out: SeriesMarker<LWCTimestamp>[] = [];
    for (const s of allSeries) {
      if (!s.markers || s.markers.length === 0) continue;
      for (const m of s.markers as IndicatorMarker[]) {
        out.push({
          time:     Math.floor(m.time / 1000) as LWCTimestamp,
          position: m.position,
          color:    m.color,
          shape:    m.shape,
          size:     m.size ?? 1,
          text:     m.text ?? '',
        });
      }
    }
    return out;
  }, [allSeries]);

  // ── Candle timer Y position ───────────────────────────────────────────────
  // Keep the timer aligned to the price axis label by tracking the Y pixel of
  // the current price.  Recomputed on every price tick AND on scroll/zoom so
  // it stays glued to the label even as the scale changes.
  const [timerY, setTimerY] = useState<number | null>(null);

  const recomputeTimerY = useCallback(() => {
    const price = livePrice ?? candles[candles.length - 1]?.close;
    if (price == null) { setTimerY(null); return; }
    const y = priceRef.current?.priceToCoordinate(price) ?? null;
    setTimerY(y);
  }, [livePrice, candles]);

  // Update on every live tick (livePrice changes)
  useEffect(() => { recomputeTimerY(); }, [recomputeTimerY]);

  // Update on scroll/zoom — reuse the same logical-range-change subscription
  useEffect(() => {
    const chart = priceRef.current?.getChart();
    if (!chart) return;
    chart.timeScale().subscribeVisibleLogicalRangeChange(recomputeTimerY);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(recomputeTimerY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length, recomputeTimerY]);

  // ── Signal drop-lines ─────────────────────────────────────────────────────
  // For each live marker, compute its x pixel via timeToCoordinate so we can
  // render an absolutely-positioned vertical line + strategy label at the bottom
  // of the price pane.  Re-computes on scroll/zoom (range change) and whenever
  // liveStrategies changes (new bar close, strategy toggle).
  interface SignalLine { x: number; color: string; label: string; }
  const [signalLines, setSignalLines] = useState<SignalLine[]>([]);

  const recomputeSignalLines = useCallback(() => {
    const chart = priceRef.current?.getChart();
    if (!chart) { setSignalLines([]); return; }

    const lines: SignalLine[] = [];
    for (let idx = 0; idx < liveStrategies.length; idx++) {
      const { strategy, trades } = liveStrategies[idx]!;
      const color = STRATEGY_COLORS[idx % STRATEGY_COLORS.length]!;
      const label = (strategy.name.split(' ')[0] ?? 'S').slice(0, 4).toUpperCase();

      for (const trade of trades) {
        const times: LWCTimestamp[] = [Math.floor(trade.entryTime / 1000) as LWCTimestamp];
        if (trade.exitReason !== 'end_of_data') {
          times.push(Math.floor(trade.exitTime / 1000) as LWCTimestamp);
        }
        for (const t of times) {
          const x = chart.timeScale().timeToCoordinate(t);
          // Only include visible bars (x is null or negative when off-screen)
          if (x !== null && x >= 0) {
            lines.push({ x, color, label });
          }
        }
      }
    }
    setSignalLines(lines);
  // STRATEGY_COLORS is a module-level const; liveStrategies covers dynamic deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStrategies]);

  // Recompute whenever strategies/trades change
  useEffect(() => { recomputeSignalLines(); }, [recomputeSignalLines]);

  // Recompute on every chart scroll/zoom (the range-change event fires on pan/scale)
  useEffect(() => {
    const chart = priceRef.current?.getChart();
    if (!chart) return;
    chart.timeScale().subscribeVisibleLogicalRangeChange(recomputeSignalLines);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(recomputeSignalLines);
  // Re-subscribe when candles load (timescale gets data) or strategies change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length, recomputeSignalLines]);

  // ── Header price ──────────────────────────────────────────────────────────
  const lastCandle   = candles[candles.length - 1];
  const prevCandle   = candles[candles.length - 2];
  const displayPrice = livePrice ?? lastCandle?.close;
  const priceChange  = (lastCandle && prevCandle)
    ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
    : 0;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-surface">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 h-12 border-b border-surface-border flex-shrink-0">
        <span className="font-mono font-bold text-text-primary text-sm tracking-wide">
          {symbol}
        </span>

        {displayPrice !== undefined && (
          <>
            <span className="font-mono text-text-price text-sm">
              {displayPrice.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: displayPrice < 1 ? 6 : 2,
              })}
            </span>
            <span className={`font-mono text-xs ${priceChange >= 0 ? 'text-up' : 'text-down'}`}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </>
        )}

        {isLoading && (
          <span className="text-xs text-text-muted animate-pulse ml-2">Loading…</span>
        )}
        {error && (
          <span className="text-xs text-down ml-2">{error.message}</span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Signals strip toggle */}
          {chartStrategies.length > 0 && (
            <button
              type="button"
              onClick={() => setStripVisible((v) => !v)}
              className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors
                          ${stripVisible
                            ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10'
                            : 'border-surface-border text-text-muted hover:text-text-primary hover:border-accent/30'}`}
              title="Toggle signal strip"
            >
              Signals {chartStrategies.length} {stripVisible ? '▾' : '▸'}
            </button>
          )}

          {/* Markers toggle popover */}
          <div ref={markerMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setMarkerMenuOpen((v) => !v)}
              className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors
                          ${markerMenuOpen
                            ? 'border-accent/40 text-accent bg-accent/5'
                            : Object.values(markerVisibility).some((v) => !v)
                              ? 'border-amber-500/40 text-amber-400 hover:bg-amber-500/5'
                              : 'border-surface-border text-text-muted hover:text-text-primary hover:border-accent/30'}`}
              title="Toggle chart markers"
            >
              Markers {markerMenuOpen ? '▾' : '▸'}
            </button>

            {markerMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-72
                              rounded border border-surface-border bg-surface
                              shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-surface-border flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                    Chart markers
                  </span>
                  {/* Label toggle — hides/shows strategy name text on arrows & circles */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowMarkerLabels((v) => !v); }}
                    title="Toggle marker labels"
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono transition-colors
                                ${showMarkerLabels
                                  ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10'
                                  : 'border-surface-border text-text-muted hover:text-text-primary'}`}
                  >
                    Aa {showMarkerLabels ? 'on' : 'off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const allOn = Object.values(markerVisibility).every(Boolean);
                      const next = Object.fromEntries(
                        Object.keys(markerVisibility).map((k) => [k, !allOn])
                      ) as typeof markerVisibility;
                      setMarkerVisibility(next);
                    }}
                    className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
                  >
                    {Object.values(markerVisibility).every(Boolean) ? 'hide all' : 'show all'}
                  </button>
                </div>
                {/* ── Signal candles ── */}
                {(() => {
                  const cat = MARKER_CATEGORIES.find((c) => c.key === 'rawSignals')!;
                  return (
                    <div
                      key={cat.key}
                      className="flex items-start gap-3 px-3 py-2.5 border-b border-surface-border
                                 hover:bg-surface-2 transition-colors cursor-pointer"
                      onClick={() => toggleMarker(cat.key)}
                    >
                      <div className={`mt-0.5 w-3.5 h-3.5 rounded flex-shrink-0 border flex items-center justify-center
                                      transition-colors ${markerVisibility[cat.key]
                                        ? 'border-accent bg-accent/20'
                                        : 'border-surface-border bg-transparent'}`}>
                        {markerVisibility[cat.key] && <span className="text-[8px] text-accent leading-none">✓</span>}
                      </div>
                      <span className="text-sm flex-shrink-0 w-4 text-center leading-none mt-px"
                            style={{ color: markerVisibility[cat.key] ? cat.color : '#4b5563' }}>
                        {cat.shape}
                      </span>
                      <div className="min-w-0">
                        <div className={`text-[11px] font-mono font-medium transition-colors
                                         ${markerVisibility[cat.key] ? 'text-text-primary' : 'text-text-muted'}`}>
                          {cat.label}
                        </div>
                        <div className="text-[10px] text-text-muted leading-relaxed mt-0.5">{cat.desc}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Backtest trades section ── */}
                {(() => {
                  const sectionOn = markerVisibility.tradeEntries && markerVisibility.tradeExits;
                  const sectionMixed = markerVisibility.tradeEntries !== markerVisibility.tradeExits;
                  const toggleSection = () => {
                    const next = !sectionOn;
                    setMarkerVisibility((prev) => ({ ...prev, tradeEntries: next, tradeExits: next }));
                  };
                  const subCats = MARKER_CATEGORIES.filter(
                    (c) => c.key === 'tradeEntries' || c.key === 'tradeExits',
                  );
                  return (
                    <>
                      {/* Section header row */}
                      <div
                        className="flex items-center gap-3 px-3 py-2 border-b border-surface-border
                                   hover:bg-surface-2 transition-colors cursor-pointer"
                        onClick={toggleSection}
                      >
                        <div className={`w-3.5 h-3.5 rounded flex-shrink-0 border flex items-center justify-center
                                        transition-colors ${sectionOn
                                          ? 'border-accent bg-accent/20'
                                          : sectionMixed
                                            ? 'border-accent/50 bg-accent/10'
                                            : 'border-surface-border bg-transparent'}`}>
                          {sectionOn
                            ? <span className="text-[8px] text-accent leading-none">✓</span>
                            : sectionMixed
                              ? <span className="text-[8px] text-accent/60 leading-none">–</span>
                              : null}
                        </div>
                        <span className="text-[10px] font-mono uppercase tracking-wider
                                         text-text-muted leading-none flex-1">
                          Backtest trades
                        </span>
                        <span className={`text-[9px] font-mono transition-colors ${
                          sectionOn ? 'text-accent' : 'text-text-muted/50'
                        }`}>
                          {sectionOn ? 'on' : sectionMixed ? 'mixed' : 'off'}
                        </span>
                      </div>
                      {/* Sub-rows */}
                      {subCats.map((cat) => {
                        const subOn = markerVisibility[cat.key];
                        const sectionOff = !markerVisibility.tradeEntries && !markerVisibility.tradeExits;
                        return (
                          <div
                            key={cat.key}
                            className={`flex items-start gap-3 pl-8 pr-3 py-2 border-b border-surface-border
                                        hover:bg-surface-2 transition-colors cursor-pointer
                                        ${sectionOff ? 'opacity-40' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleMarker(cat.key); }}
                          >
                            <div className={`mt-0.5 w-3 h-3 rounded flex-shrink-0 border flex items-center justify-center
                                            transition-colors ${subOn
                                              ? 'border-accent bg-accent/20'
                                              : 'border-surface-border bg-transparent'}`}>
                              {subOn && <span className="text-[7px] text-accent leading-none">✓</span>}
                            </div>
                            <span className="text-xs flex-shrink-0 w-4 text-center leading-none mt-px"
                                  style={{ color: subOn && !sectionOff ? cat.color : '#4b5563' }}>
                              {cat.shape}
                            </span>
                            <div className="min-w-0">
                              <div className={`text-[11px] font-mono font-medium transition-colors
                                               ${subOn && !sectionOff ? 'text-text-primary' : 'text-text-muted'}`}>
                                {cat.label}
                              </div>
                              <div className="text-[10px] text-text-muted leading-relaxed mt-0.5">{cat.desc}</div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {/* ── Patterns + Drop-lines ── */}
                {MARKER_CATEGORIES.filter((c) => c.key === 'patterns' || c.key === 'dropLines').map((cat, _i, arr) => (
                  <div
                    key={cat.key}
                    className={`flex items-start gap-3 px-3 py-2.5 border-b border-surface-border
                               ${cat.key === arr[arr.length - 1]?.key ? 'last:border-b-0' : ''}
                               hover:bg-surface-2 transition-colors cursor-pointer`}
                    onClick={() => toggleMarker(cat.key)}
                  >
                    <div className={`mt-0.5 w-3.5 h-3.5 rounded flex-shrink-0 border flex items-center justify-center
                                    transition-colors ${markerVisibility[cat.key]
                                      ? 'border-accent bg-accent/20'
                                      : 'border-surface-border bg-transparent'}`}>
                      {markerVisibility[cat.key] && <span className="text-[8px] text-accent leading-none">✓</span>}
                    </div>
                    <span className="text-sm flex-shrink-0 w-4 text-center leading-none mt-px"
                          style={{ color: markerVisibility[cat.key] ? cat.color : '#4b5563' }}>
                      {cat.shape}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-[11px] font-mono font-medium transition-colors
                                       ${markerVisibility[cat.key] ? 'text-text-primary' : 'text-text-muted'}`}>
                        {cat.label}
                      </div>
                      <div className="text-[10px] text-text-muted leading-relaxed mt-0.5">{cat.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <IndicatorSelector />
          <TimeframeSelector />
          {/* Scroll back to the most recent candle — all panes together */}
          <button
            onClick={() => {
              const total = candles.length;
              if (total === 0) return;
              // setVisibleLogicalRange fires subscribeVisibleLogicalRangeChange
              // synchronously, so the bidirectional sync propagates to all panes.
              priceRef.current?.getChart()?.timeScale().setVisibleLogicalRange({
                from: (total - 81) as Logical,
                to:   (total + 3)  as Logical,
              });
            }}
            title="Go to current time"
            className="px-2 py-1 rounded bg-surface-2 border border-surface-border
                       text-[11px] font-mono text-text-secondary
                       hover:text-text-primary hover:border-accent/50 transition-colors"
          >
            Now
          </button>
        </div>
      </div>

      {/* ── Signal strip ─────────────────────────────────────────────────── */}
      {stripVisible && chartStrategies.length > 0 && (
        <div
          ref={chipsRef}
          className="flex items-center gap-1.5 flex-wrap px-3 py-1.5
                     border-b border-surface-border bg-surface/60"
        >
          {chartStrategies.map((strategy, idx) => {
            const isActive   = strategy.isActive ?? false;
            const isPinned   = pinnedChipIds.has(strategy.id);
            const liveState  = liveStrategies.find((ls) => ls.strategy.id === strategy.id);
            const lastSignal = liveState?.lastSignal ?? null;
            const color      = STRATEGY_COLORS[idx % STRATEGY_COLORS.length]!;

            const allConditions    = strategy.entryConditions.flatMap((g) => g.conditions);
            const totalConditions  = allConditions.length;
            const activeConditions = allConditions.filter((c) => c.enabled !== false).length;
            const rating           = Math.min(5, Math.max(1, activeConditions));
            const stars            = '⭐'.repeat(rating);
            const opSym: Record<string, string> = {
              gt: '>', lt: '<', gte: '≥', lte: '≤',
              crosses_above: '↑ crosses above', crosses_below: '↓ crosses below',
            };
            const fmtCond = (c: (typeof allConditions)[number]) => {
              const op = opSym[c.operator] ?? c.operator;
              if (c.indicatorId === '__price__') return `Price ${op} ${c.value}`;
              const params = Object.values(c.params).join(',');
              const mode   = c.checkMode === 'lookback' ? ` [L${c.checkCandles ?? 1}]` : c.checkCandles && c.checkCandles > 1 ? ` [C${c.checkCandles}]` : '';
              return `${c.indicatorId.toUpperCase()}(${params}) ${op} ${c.value}${mode}`;
            };

            return (
              <div
                key={strategy.id}
                className={`group relative flex items-center gap-1 px-2 py-0.5 rounded
                            border cursor-pointer select-none transition-all
                            ${isPinned
                              ? 'bg-surface-2 border-accent/50'
                              : 'bg-surface-2 border-surface-border hover:border-accent/30'}`}
                onClick={() => togglePin(strategy.id)}
              >
                {/* Visual content — dimmed when inactive */}
                <div className={`flex items-center gap-1 transition-opacity ${isActive ? '' : 'opacity-40'}`}>
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: isActive ? color : '#4b5563' }}
                  />
                  <span className="text-xs font-mono text-text-secondary truncate max-w-[90px]">
                    {strategy.name}
                  </span>
                  {isActive && lastSignal && (
                    <span
                      className="text-[10px] font-mono font-medium"
                      style={{
                        color: lastSignal.exitReason === 'end_of_data'
                          ? color
                          : lastSignal.pnlPct >= 0 ? '#10b981' : '#ef4444',
                      }}
                    >
                      {lastSignal.exitReason === 'end_of_data'
                        ? `● ${lastSignal.direction === 'long' ? 'L' : 'S'}`
                        : `${lastSignal.pnlPct >= 0 ? '+' : ''}${lastSignal.pnlPct.toFixed(1)}%`}
                    </span>
                  )}
                </div>

                {/* ── Tooltip — hover preview, click to pin ───────────── */}
                <div
                  className={`absolute top-full left-0 mt-1.5 z-50
                              w-64 rounded border border-surface-border
                              bg-surface shadow-xl text-xs text-text-primary
                              transition-opacity duration-150
                              ${isPinned
                                ? 'visible opacity-100'
                                : 'invisible group-hover:visible opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-3 py-2 border-b border-surface-border">
                    <div className="font-mono font-medium truncate">{strategy.name}</div>
                    {strategy.longName && (
                      <div className="text-text-muted truncate mt-0.5">{strategy.longName}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-text-muted">{strategy.symbol} · {strategy.timeframe}</span>
                      <span
                        className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: color + '22', color }}
                      >
                        {strategy.action.type === 'enter_long' ? 'LONG' : 'SHORT'}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="px-3 py-2 border-b border-surface-border flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        toggleStrategyActive(strategy.id);
                        setPinnedChipIds((prev) => new Set([...prev, strategy.id]));
                        const updated = { ...strategy, isActive: !(strategy.isActive ?? false) };
                        fetch('/api/strategies', {
                          method:  'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body:    JSON.stringify(updated),
                        }).catch((err) => console.warn('[strategy-toggle] DB sync failed:', err));
                      }}
                      className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px]
                                  font-mono transition-colors
                                  ${isActive
                                    ? 'border-down/40 text-down hover:bg-down/10'
                                    : 'border-up/40 text-up hover:bg-up/10'}`}
                    >
                      <span>⏻</span>
                      <span>{isActive ? 'Deactivate' : 'Activate'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveStrategy(strategy.id);
                        router.push('/strategy');
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded border
                                 border-surface-border text-[11px] font-mono text-text-muted
                                 hover:text-text-primary hover:border-accent/40 transition-colors"
                    >
                      <span>⚙</span>
                      <span>Settings</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => dismissChip(strategy.id)}
                      className="ml-auto flex items-center justify-center w-6 h-6 rounded
                                 border border-surface-border text-[11px] text-text-muted
                                 hover:text-down hover:border-down/40 transition-colors"
                      title="Hide chip"
                    >
                      ×
                    </button>
                  </div>

                  {/* Rating + conditions */}
                  <div className="px-3 py-2 border-b border-surface-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">Rating</span>
                      <span>
                        {stars}{' '}
                        <span className="text-text-muted">
                          ({activeConditions < totalConditions
                            ? `${activeConditions}/${totalConditions}`
                            : totalConditions})
                        </span>
                      </span>
                    </div>
                    {allConditions.length === 0 ? (
                      <div className="text-text-muted italic">No entry conditions</div>
                    ) : (
                      allConditions.map((c) => {
                        const enabled = c.enabled !== false;
                        return (
                          <div key={c.id} className="flex items-start gap-1 font-mono text-[10px]">
                            <span className={`mt-px ${enabled ? 'text-up' : 'text-text-muted'}`}>
                              {enabled ? '✓' : '○'}
                            </span>
                            <span className={`${enabled ? 'text-text-secondary' : 'text-text-muted line-through'}`}>
                              {fmtCond(c)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Risk + notify */}
                  <div className="px-3 py-2 flex items-center gap-3">
                    <span className="text-text-muted">SL</span>
                    <span className={strategy.risk.stopLossPct > 0 ? 'text-down' : 'text-text-muted'}>
                      {strategy.risk.stopLossPct > 0 ? `${strategy.risk.stopLossPct}%` : '—'}
                    </span>
                    <span className="text-text-muted">TP</span>
                    <span className={strategy.risk.takeProfitPct > 0 ? 'text-up' : 'text-text-muted'}>
                      {strategy.risk.takeProfitPct > 0 ? `${strategy.risk.takeProfitPct}%` : '—'}
                    </span>
                    {strategy.notifyOnSignal && (
                      <span className="ml-auto text-[10px] text-text-muted">🔔 notify</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stale data banner ────────────────────────────────────────────── */}
      {isStale && <StaleDataBanner />}

      {/* ── Chart stack: price pane + sub-panes ─────────────────────────── */}
      {/* Outer wrapper is `relative` so the single CSS vertical crosshair line
          can be absolutely positioned and span the full height of all panes. */}
      <div className="flex-1 min-h-0 flex flex-col relative">

        {/* Single vertical crosshair — spans price chart AND all sub-panes.
            Driven by onCrosshair from whichever pane the cursor is currently on. */}
        {crosshairX !== null && (
          <div
            className="absolute top-0 bottom-0 w-px pointer-events-none z-30"
            style={{
              left:       crosshairX,
              // Match LWC default LargeDashed: 8px dash, 4px gap
              background: 'repeating-linear-gradient(to bottom, #3b82f6 0px, #3b82f6 8px, transparent 8px, transparent 12px)',
            }}
          />
        )}

        {/* Price chart */}
        <div className="flex-1 min-h-0 relative">
          {isLoading && (
            <div className="absolute inset-0 z-20 bg-surface/50 flex items-center
                            justify-center pointer-events-none">
              <span className="text-xs font-mono text-text-secondary animate-pulse">
                Loading…
              </span>
            </div>
          )}
          <PriceChart
            ref={priceRef}
            candles={candles}
            overlays={overlaySeries}
            contextKey={`${symbol}-${timeframe}`}
            onCrosshair={handleCrosshair}
            crosshairTime={crosshairTime}
            showTimeAxis={subPaneGroups.size === 0}
            markers={[
              ...(markerVisibility.rawSignals   ? rawSignalMarkers   : []),
              ...(markerVisibility.tradeEntries ? tradeEntryMarkers  : []),
              ...(markerVisibility.tradeExits   ? tradeExitMarkers   : []),
              ...(markerVisibility.patterns     ? patternMarkers     : []),
            ].sort((a, b) => (a.time as number) - (b.time as number))}
          />

          {/* Candle countdown — positioned on the price axis just below the live price label */}
          {timerY !== null && (() => {
            const closeMs = liveCandle?.closeTime ?? candles[candles.length - 1]?.closeTime;
            return closeMs
              ? <CandleTimer closeTimeMs={closeMs} yPx={timerY} />
              : null;
          })()}

          {/* OHLCV + indicator legend — updates on every crosshair move */}
          <ChartLegend
            candles={candles}
            crosshairTime={crosshairTime}
            allSeries={allSeries.filter((s) => s.panel === 'overlay' || s.id === 'bbpct')}
            activeIndicators={activeIndicators}
          />

          {/* Signal drop-lines — one per live marker.
              Each line runs from top to bottom of the price pane with the
              strategy label at the foot, positioned at the marker's x coordinate.
              Re-rendered on every scroll/zoom via recomputeSignalLines. */}
          {markerVisibility.dropLines && signalLines.map((line, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-0 pointer-events-none z-10 overflow-visible"
              style={{ left: line.x }}
            >
              {/* Vertical faded indicator line */}
              <div
                className="absolute top-0 bottom-5 w-px"
                style={{
                  background: `linear-gradient(to bottom, transparent 0%, ${line.color}30 15%, ${line.color}50 85%, ${line.color}90 100%)`,
                }}
              />
              {/* Strategy name at the bottom of the line */}
              <span
                className="absolute bottom-1 text-[10px] font-mono leading-none whitespace-nowrap"
                style={{
                  left: 0,
                  transform: 'translateX(-50%)',
                  color: line.color,
                }}
              >
                {line.label}
              </span>
            </div>
          ))}
        </div>

        {/* Sub-pane charts (resizable) */}
        <div className="flex-shrink-0">
          {Array.from(subPaneGroups.entries()).map(([indicatorId, series], index, arr) => {
            const ind = INDICATORS[indicatorId];
            return (
              <div key={indicatorId} className="flex flex-col">
                <PaneResizer onDelta={(delta) => handlePaneDelta(indicatorId, delta)} />
                <SubChart
                  ref={(el) => {
                    if (el) subRefs.current.set(indicatorId, el);
                    else    subRefs.current.delete(indicatorId);
                  }}
                  series={series}
                  title={ind?.name ?? indicatorId.toUpperCase()}
                  bias={ind?.bias}
                  height={getSubHeight(indicatorId)}
                  crosshairTime={crosshairTime}
                  showTimeAxis={index === arr.length - 1}
                  onCrosshair={handleCrosshair}
                />
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
