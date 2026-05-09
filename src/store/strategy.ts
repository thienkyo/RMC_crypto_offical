/**
 * Strategy Zustand store.
 *
 * Persistence: strategies are persisted to localStorage via zustand/middleware
 * so they survive page reloads without a DB round-trip.  The /api/strategies
 * endpoint is available for optional server-side durability (Phase 2 later).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Strategy, BacktestResult } from '@/types/strategy';
import type { Timeframe } from '@/types/market';

// ── Default strategy factory ──────────────────────────────────────────────────

export function createDefaultStrategy(): Strategy {
  const now = Date.now();
  return {
    id:          `strategy_${now}`,
    name:        'New Strategy',
    description: '',
    version:     1,
    createdAt:   now,
    updatedAt:   now,
    symbol:      'BTCUSDT',
    timeframe:   '1h' as Timeframe,
    isActive:    false,
    entryConditions: [],
    exitConditions:  [],
    action: {
      type:            'enter_long',
      positionSizePct: 100,
      maxPositions:    1,
    },
    risk: {
      stopLossPct:    2,
      takeProfitPct:  4,
    },
  };
}

/** Maximum number of backtest runs retained per strategy. */
const MAX_HISTORY = 20;

// ── Store interface ───────────────────────────────────────────────────────────

interface StrategyState {
  strategies:       Strategy[];
  activeStrategyId: string | null;
  /** Latest in-session result — ephemeral, not persisted. */
  backtestResult:   BacktestResult | null;
  isBacktesting:    boolean;
  /**
   * Persisted run history keyed by strategyId.
   * Each array is newest-first, capped at MAX_HISTORY entries.
   */
  backtestHistory:  Record<string, BacktestResult[]>;

  // ── Actions ───────────────────────────────────────────────────────────────
  setStrategies:     (strategies: Strategy[]) => void;
  /** Insert or replace a strategy by id. Bumps version and updatedAt. */
  upsertStrategy:    (strategy: Strategy) => void;
  deleteStrategy:    (id: string) => void;
  setActiveStrategy: (id: string | null) => void;
  setBacktestResult: (result: BacktestResult | null) => void;
  setBacktesting:    (value: boolean) => void;
  /** Prepend a completed result to the strategy's history and persist it. */
  saveBacktestResult: (result: BacktestResult) => void;
  /** Wipe all stored runs for a strategy (e.g. after major config changes). */
  clearBacktestHistory: (strategyId: string) => void;
  /** Toggle the live-monitor ON/OFF flag for a strategy. */
  toggleStrategyActive: (id: string) => void;
  /** Clone a strategy with a new id and " (copy)" suffix. */
  duplicateStrategy: (id: string) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useStrategyStore = create<StrategyState>()(
  persist(
    (set) => ({
      strategies:       [],
      activeStrategyId: null,
      backtestResult:   null,
      isBacktesting:    false,
      backtestHistory:  {},

      setStrategies: (strategies) => set({ strategies }),

      upsertStrategy: (strategy) =>
        set((s) => ({
          strategies: [
            ...s.strategies.filter((x) => x.id !== strategy.id),
            { ...strategy, updatedAt: Date.now() },
          ],
          // Auto-select the strategy being saved
          activeStrategyId: strategy.id,
        })),

      deleteStrategy: (id) =>
        set((s) => {
          const { [id]: _dropped, ...remainingHistory } = s.backtestHistory;
          return {
            strategies:       s.strategies.filter((x) => x.id !== id),
            activeStrategyId: s.activeStrategyId === id ? null : s.activeStrategyId,
            backtestResult:   s.backtestResult?.strategyId === id ? null : s.backtestResult,
            backtestHistory:  remainingHistory,
          };
        }),

      setActiveStrategy: (id) =>
        set({ activeStrategyId: id, backtestResult: null }),

      setBacktestResult: (result) => set({ backtestResult: result }),
      setBacktesting:    (value)  => set({ isBacktesting: value }),

      saveBacktestResult: (result) =>
        set((s) => {
          const prev = s.backtestHistory[result.strategyId] ?? [];
          // Prepend newest run, deduplicate by ranAt, cap at MAX_HISTORY
          const next = [result, ...prev.filter((r) => r.ranAt !== result.ranAt)]
            .slice(0, MAX_HISTORY);
          return {
            backtestHistory: { ...s.backtestHistory, [result.strategyId]: next },
          };
        }),

      clearBacktestHistory: (strategyId) =>
        set((s) => {
          const { [strategyId]: _dropped, ...rest } = s.backtestHistory;
          return { backtestHistory: rest };
        }),

      toggleStrategyActive: (id) =>
        set((s) => ({
          strategies: s.strategies.map((x) =>
            x.id === id ? { ...x, isActive: !(x.isActive ?? false) } : x,
          ),
        })),

      duplicateStrategy: (id) =>
        set((s) => {
          const original = s.strategies.find((x) => x.id === id);
          if (!original) return {};
          const now = Date.now();
          const copy: typeof original = {
            ...original,
            id:        `strategy_${now}`,
            name:      `${original.name} (copy)`,
            version:   1,
            createdAt: now,
            updatedAt: now,
            isActive:  false, // copies start inactive — don't accidentally double-monitor
          };
          return {
            strategies:       [...s.strategies, copy],
            activeStrategyId: copy.id,
          };
        }),
    }),
    {
      name: 'rmc-strategies',
      // Only persist the strategy list and active selection; backtest results
      // are ephemeral (re-run on demand) and shouldn't inflate localStorage.
      partialize: (s) => ({
        strategies:       s.strategies,
        activeStrategyId: s.activeStrategyId,
        backtestHistory:  s.backtestHistory,
      }),
    },
  ),
);

// ── Selectors ─────────────────────────────────────────────────────────────────

export function selectActiveStrategy(state: StrategyState): Strategy | null {
  return (
    state.strategies.find((s) => s.id === state.activeStrategyId) ?? null
  );
}
