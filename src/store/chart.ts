import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Candle, Timeframe, SymbolSource } from '@/types/market';
import { isEquitySymbol } from '@/lib/exchange/equities';

export interface MarkerVisibility {
  rawSignals:   boolean;  // amber squares — every candle where entry conditions fired
  tradeEntries: boolean;  // arrows  — backtest trade entries
  tradeExits:   boolean;  // circles — backtest trade exits with P&L
  patterns:     boolean;  // arrows  — candlestick pattern detections
  dropLines:    boolean;  // vertical lines + name labels at bottom of price pane
}

export interface MarkerSettings {
  visibility:           MarkerVisibility;
  showLabels:           boolean;  // strategy name text on arrows/circles
  stripVisible:         boolean;  // strategy rules strip below the chart header
  recentSignalsVisible: boolean;  // recent fired signals strip
}

const DEFAULT_MARKER_SETTINGS: MarkerSettings = {
  visibility: {
    rawSignals:   true,
    tradeEntries: true,
    tradeExits:   true,
    patterns:     true,
    dropLines:    true,
  },
  showLabels:           true,
  stripVisible:         true,
  recentSignalsVisible: true,
};

/**
 * Fill in MarkerSettings keys a payload predates.
 *
 * Every field on MarkerSettings is required, so state written before a key
 * existed — a browser's persisted store, or a chart layout saved under an older
 * build — would otherwise restore it as `undefined`, which reads as "off" at
 * every call site while TypeScript still believes it is a boolean.
 */
export function withMarkerDefaults(m?: Partial<MarkerSettings>): MarkerSettings {
  return {
    ...DEFAULT_MARKER_SETTINGS,
    ...m,
    visibility: { ...DEFAULT_MARKER_SETTINGS.visibility, ...m?.visibility },
  };
}

export interface ActiveIndicator {
  /** Matches a key in INDICATORS registry, e.g. "ema", "rsi", "macd". */
  id: string;
  params: Record<string, number>;
  color?: string;
  visible: boolean;
}

export interface VolumeProfileConfig {
  /** Show the VP histogram on the right side of the price chart. */
  enabled:      boolean;
  /** Draw VAH / POC / VAL horizontal lines across the price chart. */
  showLines:    boolean;
  /** Number of lookback bars for the rolling profile. */
  lookback:     number;
  /** Number of price bins. */
  bins:         number;
  /** Percentage of volume that defines the Value Area. */
  valueAreaPct: number;
}

interface ChartState {
  // ── Selection ──────────────────────────────────────────────────────────────
  symbol:    string;
  source:    SymbolSource;
  timeframe: Timeframe;

  // ── Candle data ────────────────────────────────────────────────────────────
  candles:    Candle[];
  /**
   * `${symbol}-${timeframe}` of the currently loaded `candles` array, or null
   * while the series is cleared between symbol/TF switches. PriceChart uses
   * this so a WS-mutated previous array cannot be committed as new-context data.
   */
  candlesKey: string | null;
  isLoading:  boolean;
  /** True when the live feed has gone silent for too long. */
  isStale:    boolean;
  lastTickAt: number | null;

  // ── Indicators ────────────────────────────────────────────────────────────
  activeIndicators: ActiveIndicator[];

  // ── Viewport preferences (persisted) ─────────────────────────────────────
  /** Last bar spacing (candle width in px) set by the user. Restored on mount. */
  barSpacing: number;
  /** Sub-pane pixel heights keyed by indicator id (e.g. { rsi: 120, macd: 140 }). */
  subPaneHeights: Record<string, number>;
  /** Marker / signal overlay visibility preferences. */
  markerSettings: MarkerSettings;

  // ── Volume Profile ────────────────────────────────────────────────────────
  vpConfig: VolumeProfileConfig;

  // ── Actions ───────────────────────────────────────────────────────────────
  setSymbol:    (symbol: string, source?: SymbolSource) => void;
  setTimeframe: (tf: Timeframe) => void;

  /**
   * Replace the candle series. When `contextKey` is provided it must match the
   * store's current `${symbol}-${timeframe}` — in-flight fetches for a previous
   * ticker are dropped so they cannot poison the chart after a switch.
   */
  setCandles:       (candles: Candle[], contextKey?: string) => void;
  setLoading:       (loading: boolean)  => void;
  setStale:         (stale: boolean)    => void;

  /**
   * Diff-update the last candle on a live tick.
   * Calls setData only when a new bar opens; uses series.update() otherwise.
   * Returns true if a new bar was appended (caller should re-render).
   */
  updateLastCandle: (candle: Candle) => boolean;

  addIndicator:          (indicator: ActiveIndicator) => void;
  removeIndicator:       (id: string) => void;
  toggleIndicator:       (id: string) => void;
  updateIndicatorParams: (id: string, params: Record<string, number>) => void;

  setBarSpacing:     (barSpacing: number) => void;
  setSubPaneHeight:  (id: string, height: number) => void;
  /** Merge a partial update into markerSettings. */
  setMarkerSettings: (patch: { visibility?: Partial<MarkerVisibility>; showLabels?: boolean; stripVisible?: boolean; recentSignalsVisible?: boolean }) => void;
  /** Merge a partial update into vpConfig. */
  setVpConfig: (patch: Partial<VolumeProfileConfig>) => void;

  /** Atomically apply an entire layout preset snapshot */
  applyLayoutSnapshot: (snapshot: {
    timeframe?: Timeframe;
    activeIndicators?: ActiveIndicator[];
    vpConfig?: VolumeProfileConfig;
    markerSettings?: MarkerSettings;
    subPaneHeights?: Record<string, number>;
    barSpacing?: number;
    symbol?: string | null;
  }) => void;
}

/** Default indicator set shown on first load. */
const DEFAULT_INDICATORS: ActiveIndicator[] = [
  { id: 'ema',       params: { period: 20 }                     as Record<string, number>, color: '#3b82f6', visible: true },
  { id: 'bollinger', params: { period: 20, stdDevMult: 2 }      as Record<string, number>, visible: true },
  { id: 'bbpct',     params: { period: 20, stdDevMult: 2 }      as Record<string, number>, visible: true },
  { id: 'rsi',       params: { period: 14, emaPeriod: 10 }      as Record<string, number>, visible: true },
  { id: 'macd',      params: { fast: 12, slow: 26, signal: 9 }  as Record<string, number>, visible: true },
];

export const useChartStore = create<ChartState>()(
  persist(
    (set, get) => ({
      symbol:    'BTCUSDT',
      source:    'binance',
      timeframe: '1h',

      candles:    [],
      candlesKey: null,
      isLoading:  false,
      isStale:    false,
      lastTickAt: null,

      activeIndicators: DEFAULT_INDICATORS,

      barSpacing:     8,   // LWC default is ~6; 8 is slightly wider and feels better
      subPaneHeights: {},  // empty = fall back to SUB_HEIGHT_DEFAULT in ChartLayout
      markerSettings: DEFAULT_MARKER_SETTINGS,
      vpConfig: {
        enabled:      false,
        showLines:    true,
        lookback:     200,
        bins:         50,
        valueAreaPct: 70,
      },

      // ── Actions ─────────────────────────────────────────────────────────────

      setSymbol: (symbol, source) => {
        const inferredSource = source ?? (isEquitySymbol(symbol) ? 'equities' : 'binance');
        if (get().symbol === symbol && get().source === inferredSource) return;
        // Clear the series immediately so a live tick cannot merge into the
        // previous symbol's OHLC while the new history is in flight.
        set({
          symbol,
          source: inferredSource,
          candles: [],
          candlesKey: null,
          isStale: false,
          lastTickAt: null,
        });
      },

      setTimeframe: (timeframe) => {
        if (get().timeframe === timeframe) return;
        set({ timeframe, candles: [], candlesKey: null, isStale: false, lastTickAt: null });
      },

      setCandles: (candles, contextKey) => {
        const expected = `${get().symbol}-${get().timeframe}`;
        if (contextKey !== undefined && contextKey !== expected) return;
        set({
          candles,
          candlesKey: candles.length === 0 ? null : expected,
        });
      },
      setLoading:  (isLoading) => set({ isLoading }),
      setStale:    (isStale)   => set({ isStale }),

      updateLastCandle: (candle) => {
        const { candles } = get();
        if (candles.length === 0) return false;

        const last = candles[candles.length - 1]!;

        if (candle.openTime === last.openTime) {
          // Same bar — update in-place without allocating a new array head
          const next = [...candles];
          next[next.length - 1] = candle;
          set({ candles: next, lastTickAt: Date.now(), isStale: false });
          return false;
        }

        if (candle.openTime > last.openTime) {
          // New bar opened — append
          set({ candles: [...candles, candle], lastTickAt: Date.now(), isStale: false });
          return true;
        }

        return false;
      },

      addIndicator: (indicator) =>
        set((s) => ({
          activeIndicators: [
            ...s.activeIndicators.filter((i) => i.id !== indicator.id),
            indicator,
          ],
        })),

      removeIndicator: (id) =>
        set((s) => ({ activeIndicators: s.activeIndicators.filter((i) => i.id !== id) })),

      toggleIndicator: (id) =>
        set((s) => ({
          activeIndicators: s.activeIndicators.map((i) =>
            i.id === id ? { ...i, visible: !i.visible } : i,
          ),
        })),

      updateIndicatorParams: (id, params) =>
        set((s) => ({
          activeIndicators: s.activeIndicators.map((i) =>
            i.id === id ? { ...i, params: { ...i.params, ...params } } : i,
          ),
        })),

      setBarSpacing: (barSpacing) => set({ barSpacing }),

      setSubPaneHeight: (id, height) =>
        set((s) => ({ subPaneHeights: { ...s.subPaneHeights, [id]: height } })),

      setMarkerSettings: (patch) =>
        set((s) => ({
          markerSettings: {
            ...s.markerSettings,
            ...patch,
            // Deep-merge visibility so callers can pass a single key without
            // wiping the other four.
            visibility: patch.visibility
              ? { ...s.markerSettings.visibility, ...patch.visibility }
              : s.markerSettings.visibility,
          },
        })),

      setVpConfig: (patch) =>
        set((s) => ({ vpConfig: { ...s.vpConfig, ...patch } })),

      applyLayoutSnapshot: (snapshot) =>
        set((s) => {
          const symbol    = snapshot.symbol    || s.symbol;
          const timeframe = snapshot.timeframe || s.timeframe;
          // Keep source in step with symbol — a layout pinned to an equity would
          // otherwise land an equity ticker on the crypto code paths.
          const source    = isEquitySymbol(symbol) ? 'equities' : 'binance';
          // Changing either invalidates the loaded series, so we must clear it
          // exactly the way setSymbol/setTimeframe do — otherwise a live tick
          // merges into the previous context's OHLC and the chart renders the
          // old ticker's candles (and indicator values) under the new label.
          const contextChanged = symbol !== s.symbol || timeframe !== s.timeframe || source !== s.source;

          return {
            symbol,
            source,
            timeframe,
            ...(snapshot.activeIndicators !== undefined ? { activeIndicators: snapshot.activeIndicators } : {}),
            ...(snapshot.vpConfig ? { vpConfig: snapshot.vpConfig } : {}),
            // Backfilled, not assigned raw: a layout saved before a marker key
            // existed would otherwise write undefined over a live setting.
            ...(snapshot.markerSettings ? { markerSettings: withMarkerDefaults(snapshot.markerSettings) } : {}),
            ...(snapshot.subPaneHeights !== undefined ? { subPaneHeights: snapshot.subPaneHeights } : {}),
            ...(snapshot.barSpacing !== undefined ? { barSpacing: snapshot.barSpacing } : {}),
            ...(contextChanged
              ? { candles: [], candlesKey: null, isStale: false, lastTickAt: null }
              : {}),
          };
        }),
    }),
    {
      name: 'rmc-chart',
      /**
       * Rehydrate through withMarkerDefaults so a browser whose stored
       * markerSettings predates a key (e.g. recentSignalsVisible) does not
       * restore it as undefined — zustand's default merge is a shallow
       * top-level merge, so the whole object is replaced, gaps and all.
       */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChartState>;
        const symbol = p.symbol ?? current.symbol;
        return {
          ...current,
          ...p,
          // Derive source from the symbol rather than trusting what was stored.
          // setSymbol already does this, but nothing calls setSymbol on
          // rehydrate — so state written before source was persisted came back
          // as 'binance' on an equity symbol, which opened a Binance WebSocket
          // for e.g. AAPL and left it reconnecting every 2s until the first click.
          source: isEquitySymbol(symbol) ? 'equities' : 'binance',
          markerSettings: withMarkerDefaults(p.markerSettings),
        };
      },
      // Persist only user preferences — never the raw candle data (too large)
      // or ephemeral connection state.
      partialize: (s) => ({
        symbol:           s.symbol,
        source:           s.source,
        timeframe:        s.timeframe,
        activeIndicators: s.activeIndicators,
        barSpacing:       s.barSpacing,
        subPaneHeights:   s.subPaneHeights,
        markerSettings:   s.markerSettings,
        vpConfig:         s.vpConfig,
      }),
    },
  ),
);
