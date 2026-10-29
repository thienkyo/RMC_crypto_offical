import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Timeframe } from '@/types/market';

export type MultiChartLayout = '1x1' | '1x2' | '2x1' | '2x2' | '1+2' | '3x2';
export type MultiChartMode = 'mtf' | 'watchlist';

export interface ChartTileConfig {
  id: string;
  symbol: string;
  timeframe: Timeframe;
}

export interface MultiChartOverlaysConfig {
  bb: boolean;       // Bollinger Bands (20, 2)
  ema20: boolean;    // EMA 20
  ema90: boolean;    // EMA 90
  ema200: boolean;   // EMA 200
  signals: boolean;  // Strategy signals (timeframe-matched)
}

const DEFAULT_OVERLAYS: MultiChartOverlaysConfig = {
  bb: true,
  ema20: true,
  ema90: true,
  ema200: true,
  signals: true,
};

const DEFAULT_MTF_TILES: ChartTileConfig[] = [
  { id: 'tile-0', symbol: 'BTCUSDT', timeframe: '1d' },
  { id: 'tile-1', symbol: 'BTCUSDT', timeframe: '4h' },
  { id: 'tile-2', symbol: 'BTCUSDT', timeframe: '1h' },
  { id: 'tile-3', symbol: 'BTCUSDT', timeframe: '15m' },
  { id: 'tile-4', symbol: 'BTCUSDT', timeframe: '30m' },
  { id: 'tile-5', symbol: 'BTCUSDT', timeframe: '5m' },
];

const DEFAULT_WATCHLIST_TILES: ChartTileConfig[] = [
  { id: 'tile-0', symbol: 'BTCUSDT', timeframe: '4h' },
  { id: 'tile-1', symbol: 'ETHUSDT', timeframe: '4h' },
  { id: 'tile-2', symbol: 'SOLUSDT', timeframe: '4h' },
  { id: 'tile-3', symbol: 'BNBUSDT', timeframe: '4h' },
  { id: 'tile-4', symbol: 'NEARUSDT', timeframe: '4h' },
  { id: 'tile-5', symbol: 'PAXGUSDT', timeframe: '4h' },
];

interface MultiChartState {
  mode: MultiChartMode;
  layout: MultiChartLayout;
  globalSymbol: string;
  syncCrosshair: boolean;
  overlays: MultiChartOverlaysConfig;
  tiles: ChartTileConfig[];
  maximizedTileId: string | null;

  setMode: (mode: MultiChartMode) => void;
  setLayout: (layout: MultiChartLayout) => void;
  setGlobalSymbol: (symbol: string) => void;
  setSyncCrosshair: (sync: boolean) => void;
  setOverlays: (partial: Partial<MultiChartOverlaysConfig>) => void;
  updateTile: (id: string, partial: Partial<ChartTileConfig>) => void;
  toggleMaximizeTile: (id: string) => void;
  resetDefaultTiles: (mode?: MultiChartMode) => void;
}

export const useMultiChartStore = create<MultiChartState>()(
  persist(
    (set, get) => ({
      mode: 'mtf',
      layout: '2x2',
      globalSymbol: 'BTCUSDT',
      syncCrosshair: true,
      overlays: DEFAULT_OVERLAYS,
      tiles: DEFAULT_MTF_TILES,
      maximizedTileId: null,

      setMode: (mode) => {
        const currentSymbol = get().globalSymbol || 'BTCUSDT';
        if (mode === 'mtf') {
          // Switch to multi-timeframe using the current global symbol
          const nextTiles = DEFAULT_MTF_TILES.map((t) => ({ ...t, symbol: currentSymbol }));
          set({ mode, tiles: nextTiles });
        } else {
          set({ mode, tiles: DEFAULT_WATCHLIST_TILES });
        }
      },

      setLayout: (layout) => set({ layout, maximizedTileId: null }),

      setGlobalSymbol: (symbol) => {
        const cleanSymbol = symbol.trim().toUpperCase();
        const { mode, tiles } = get();
        if (mode === 'mtf') {
          // In MTF mode, changing the global symbol updates all tiles
          set({
            globalSymbol: cleanSymbol,
            tiles: tiles.map((t) => ({ ...t, symbol: cleanSymbol })),
          });
        } else {
          set({ globalSymbol: cleanSymbol });
        }
      },

      setSyncCrosshair: (syncCrosshair) => set({ syncCrosshair }),

      setOverlays: (partial) =>
        set((s) => ({ overlays: { ...s.overlays, ...partial } })),

      updateTile: (id, partial) =>
        set((s) => ({
          tiles: s.tiles.map((t) => (t.id === id ? { ...t, ...partial } : t)),
        })),

      toggleMaximizeTile: (id) =>
        set((s) => ({
          maximizedTileId: s.maximizedTileId === id ? null : id,
        })),

      resetDefaultTiles: (customMode) => {
        const mode = customMode ?? get().mode;
        const sym = get().globalSymbol || 'BTCUSDT';
        if (mode === 'mtf') {
          set({ tiles: DEFAULT_MTF_TILES.map((t) => ({ ...t, symbol: sym })) });
        } else {
          set({ tiles: DEFAULT_WATCHLIST_TILES });
        }
      },
    }),
    {
      name: 'rmc_multichart_store',
      partialize: (s) => ({
        mode: s.mode,
        layout: s.layout,
        globalSymbol: s.globalSymbol,
        syncCrosshair: s.syncCrosshair,
        overlays: s.overlays,
        tiles: s.tiles,
      }),
    },
  ),
);
