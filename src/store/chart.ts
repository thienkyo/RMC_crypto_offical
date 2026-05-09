import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Candle, Timeframe } from '@/types/market';

export interface ActiveIndicator {
  /** Matches a key in INDICATORS registry, e.g. "ema", "rsi", "macd". */
  id: string;
  params: Record<string, number>;
  color?: string;
  visible: boolean;
}

interface ChartState {
  // ── Selection ──────────────────────────────────────────────────────────────
  symbol:    string;
  timeframe: Timeframe;

  // ── Candle data ────────────────────────────────────────────────────────────
  candles:    Candle[];
  isLoading:  boolean;
  /** True when the live feed has gone silent for too long. */
  isStale:    boolean;
  lastTickAt: number | null;

  // ── Indicators ────────────────────────────────────────────────────────────
  activeIndicators: ActiveIndicator[];

  // ── Actions ───────────────────────────────────────────────────────────────
  setSymbol:    (symbol: string) => void;
  setTimeframe: (tf: Timeframe) => void;

  setCandles:       (candles: Candle[]) => void;
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
      timeframe: '1h',

      candles:    [],
      isLoading:  false,
      isStale:    false,
      lastTickAt: null,

      activeIndicators: DEFAULT_INDICATORS,

      // ── Actions ─────────────────────────────────────────────────────────────

      setSymbol: (symbol) =>
        // Don't clear candles — keep previous chart visible while new data loads.
        // TanStack Query's keepPreviousData + setCandles() on queryFn success handles the swap.
        set({ symbol, isStale: false, lastTickAt: null }),

      setTimeframe: (timeframe) =>
        set({ timeframe, isStale: false, lastTickAt: null }),

      setCandles:  (candles)   => set({ candles }),
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
    }),
    {
      name: 'rmc-chart',
      // Persist only user preferences — never the raw candle data (too large)
      // or ephemeral connection state.
      partialize: (s) => ({
        symbol:           s.symbol,
        timeframe:        s.timeframe,
        activeIndicators: s.activeIndicators,
      }),
    },
  ),
);
