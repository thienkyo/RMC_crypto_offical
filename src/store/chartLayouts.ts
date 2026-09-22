import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Timeframe } from '@/types/market';
import type {
  ActiveIndicator,
  VolumeProfileConfig,
  MarkerSettings,
} from '@/store/chart';
import { useChartStore } from '@/store/chart';

export interface SavedChartLayout {
  id: string;
  name: string;
  timeframe: Timeframe;
  activeIndicators: ActiveIndicator[];
  vpConfig: VolumeProfileConfig;
  markerSettings: MarkerSettings;
  subPaneHeights: Record<string, number>;
  barSpacing: number;
  /** Optional symbol binding. If null/undefined, layout acts as an asset-agnostic template. */
  symbol?: string | null;
  createdAt: number;
  updatedAt: number;
  isBuiltIn?: boolean;
}

const DEFAULT_LAYOUTS: SavedChartLayout[] = [
  {
    id: 'builtin-trend',
    name: 'Trend & Momentum',
    timeframe: '1h',
    activeIndicators: [
      { id: 'ema', params: { period: 20 }, color: '#3b82f6', visible: true },
      { id: 'bollinger', params: { period: 20, stdDevMult: 2 }, visible: true },
      { id: 'rsi', params: { period: 14, emaPeriod: 10 }, visible: true },
      { id: 'macd', params: { fast: 12, slow: 26, signal: 9 }, visible: true },
    ],
    vpConfig: {
      enabled: false,
      showLines: true,
      lookback: 200,
      bins: 50,
      valueAreaPct: 70,
    },
    markerSettings: {
      visibility: {
        rawSignals: true,
        tradeEntries: true,
        tradeExits: true,
        patterns: true,
        dropLines: true,
      },
      showLabels: true,
      stripVisible: true,
    },
    subPaneHeights: { rsi: 120, macd: 140 },
    barSpacing: 8,
    symbol: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    isBuiltIn: true,
  },
  {
    id: 'builtin-scalp',
    name: 'Scalp 5m',
    timeframe: '5m',
    activeIndicators: [
      // One entry per indicator id: ActiveIndicator.id keys the INDICATORS
      // registry, and addIndicator / toggleIndicator / updateIndicatorParams all
      // match on it, so a second { id: 'ema' } would toggle and re-param the
      // first one and both would compute the same series id.
      { id: 'ema', params: { period: 9 }, color: '#10b981', visible: true },
      { id: 'rsi', params: { period: 7, emaPeriod: 5 }, visible: true },
    ],
    vpConfig: {
      enabled: true,
      showLines: true,
      lookback: 120,
      bins: 50,
      valueAreaPct: 70,
    },
    markerSettings: {
      visibility: {
        rawSignals: true,
        tradeEntries: true,
        tradeExits: true,
        patterns: true,
        dropLines: true,
      },
      showLabels: true,
      stripVisible: true,
    },
    subPaneHeights: { rsi: 110 },
    barSpacing: 10,
    symbol: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    isBuiltIn: true,
  },
  {
    id: 'builtin-clean',
    name: 'Clean Price Action',
    timeframe: '1h',
    activeIndicators: [],
    vpConfig: {
      enabled: false,
      showLines: false,
      lookback: 200,
      bins: 50,
      valueAreaPct: 70,
    },
    markerSettings: {
      visibility: {
        rawSignals: false,
        tradeEntries: true,
        tradeExits: true,
        patterns: true,
        dropLines: false,
      },
      showLabels: true,
      stripVisible: true,
    },
    subPaneHeights: {},
    barSpacing: 8,
    symbol: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    isBuiltIn: true,
  },
];

interface ChartLayoutState {
  layouts: SavedChartLayout[];
  activeLayoutId: string | null;

  saveCurrentLayout: (name: string, pinSymbol?: boolean) => SavedChartLayout;
  updateActiveLayout: () => boolean;
  applyLayout: (id: string, applySymbol?: boolean) => boolean;
  deleteLayout: (id: string) => boolean;
  renameLayout: (id: string, newName: string) => boolean;
  setActiveLayoutId: (id: string | null) => void;
}

export const useChartLayoutStore = create<ChartLayoutState>()(
  persist(
    (set, get) => ({
      layouts: DEFAULT_LAYOUTS,
      // null, not a built-in id: on first load the chart holds the store's own
      // DEFAULT_INDICATORS, not any layout, so claiming one is active would
      // tick it in the selector and badge it 'Active' in the palette untruthfully.
      activeLayoutId: null,

      saveCurrentLayout: (name: string, pinSymbol = false) => {
        const chartState = useChartStore.getState();
        const now = Date.now();
        const newLayout: SavedChartLayout = {
          id: `layout-${now}`,
          name: name.trim() || 'Untitled Layout',
          timeframe: chartState.timeframe,
          activeIndicators: chartState.activeIndicators,
          vpConfig: chartState.vpConfig,
          markerSettings: chartState.markerSettings,
          subPaneHeights: chartState.subPaneHeights,
          barSpacing: chartState.barSpacing,
          symbol: pinSymbol ? chartState.symbol : null,
          createdAt: now,
          updatedAt: now,
          isBuiltIn: false,
        };

        set((s) => ({
          layouts: [...s.layouts, newLayout],
          activeLayoutId: newLayout.id,
        }));

        return newLayout;
      },

      updateActiveLayout: () => {
        const { activeLayoutId, layouts } = get();
        if (!activeLayoutId) return false;

        const target = layouts.find((l) => l.id === activeLayoutId);
        if (!target || target.isBuiltIn) return false;

        const chartState = useChartStore.getState();
        const now = Date.now();

        set((s) => ({
          layouts: s.layouts.map((l) =>
            l.id === activeLayoutId
              ? {
                  ...l,
                  timeframe: chartState.timeframe,
                  activeIndicators: chartState.activeIndicators,
                  vpConfig: chartState.vpConfig,
                  markerSettings: chartState.markerSettings,
                  subPaneHeights: chartState.subPaneHeights,
                  barSpacing: chartState.barSpacing,
                  symbol: l.symbol ? chartState.symbol : null,
                  updatedAt: now,
                }
              : l,
          ),
        }));

        return true;
      },

      applyLayout: (id: string, forceApplySymbol = false) => {
        const layout = get().layouts.find((l) => l.id === id);
        if (!layout) return false;

        useChartStore.getState().applyLayoutSnapshot({
          timeframe: layout.timeframe,
          activeIndicators: layout.activeIndicators,
          vpConfig: layout.vpConfig,
          markerSettings: layout.markerSettings,
          subPaneHeights: layout.subPaneHeights,
          barSpacing: layout.barSpacing,
          ...(forceApplySymbol || layout.symbol ? { symbol: layout.symbol ?? undefined } : {}),
        });

        set({ activeLayoutId: id });
        return true;
      },

      deleteLayout: (id: string) => {
        const { layouts, activeLayoutId } = get();
        const target = layouts.find((l) => l.id === id);
        if (!target || target.isBuiltIn) return false;

        const remaining = layouts.filter((l) => l.id !== id);
        set({
          layouts: remaining,
          activeLayoutId: activeLayoutId === id ? (remaining[0]?.id ?? null) : activeLayoutId,
        });

        return true;
      },

      renameLayout: (id: string, newName: string) => {
        const name = newName.trim();
        if (!name) return false;

        set((s) => ({
          layouts: s.layouts.map((l) =>
            l.id === id ? { ...l, name, updatedAt: Date.now() } : l,
          ),
        }));

        return true;
      },

      setActiveLayoutId: (id) => set({ activeLayoutId: id }),
    }),
    {
      name: 'rmc-saved-layouts',
      version: 2,
      /**
       * Persist only user-created layouts. v1 stored the built-ins too, which
       * froze DEFAULT_LAYOUTS into localStorage on first load — any later fix to
       * a built-in (or a newly added one) could never reach a browser that had
       * already opened the app.
       */
      partialize: (s) => ({
        layouts:        s.layouts.filter((l) => !l.isBuiltIn),
        activeLayoutId: s.activeLayoutId,
      }),
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Partial<
          Pick<ChartLayoutState, 'layouts' | 'activeLayoutId'>
        >;
        if (fromVersion >= 2) return p;
        // v1 → v2: drop the persisted copies of the built-ins so the ones in
        // code win, and release an activeLayoutId that pointed at a stale one.
        const userLayouts = (p.layouts ?? []).filter((l) => !l.isBuiltIn);
        const activeId    = p.activeLayoutId ?? null;
        return {
          layouts:        userLayouts,
          activeLayoutId: userLayouts.some((l) => l.id === activeId) ? activeId : null,
        };
      },
      // Built-ins come from code on every load; only user layouts are restored.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<
          Pick<ChartLayoutState, 'layouts' | 'activeLayoutId'>
        >;
        const userLayouts = (p.layouts ?? []).filter((l) => !l.isBuiltIn);
        return {
          ...current,
          layouts:        [...DEFAULT_LAYOUTS, ...userLayouts],
          activeLayoutId: p.activeLayoutId ?? null,
        };
      },
    },
  ),
);
