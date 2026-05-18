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
import { STARTER_TEMPLATES } from '@/lib/strategy/starterTemplates';

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

export function createDefaultTemplate(): Strategy {
  return {
    ...createDefaultStrategy(),
    name:       'New Template',
    isTemplate: true,
    isActive:   false,
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
  /**
   * Set all non-template strategies in a symbol group to the given active state.
   * If `active` is undefined, it flips: if ANY are on → turn all off; if all off → turn all on.
   */
  setGroupActive: (symbol: string, active?: boolean) => void;
  /** Clone a strategy with a new id and " (copy)" suffix. */
  duplicateStrategy: (id: string) => void;
  /**
   * Clone every strategy belonging to `fromSymbol` to `targetSymbol`.
   * All conditions, risk params, and action are copied verbatim.
   * Each copy gets a new id, starts inactive, and is named identically
   * (the symbol change is visible from the group it lands in).
   * Returns the number of strategies cloned.
   */
  copyGroupToSymbol: (fromSymbol: string, targetSymbol: string) => number;
  /**
   * Clone a single strategy to a different symbol.
   * Copies all conditions, risk params, and action verbatim; assigns a new id,
   * sets the symbol to targetSymbol, and starts inactive.
   */
  cloneStrategyToSymbol: (id: string, targetSymbol: string) => void;
  /**
   * Clone a template into a regular working strategy.
   * Sets isTemplate to false, prefixes name with "Copy of ", assigns a new id.
   */
  cloneFromTemplate: (templateId: string) => void;
  /**
   * Upsert the STARTER_TEMPLATES into the store (by id).
   * Existing templates with the same id are replaced so this is idempotent.
   * Regular strategies and custom templates are unaffected.
   */
  loadStarterTemplates: () => void;
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

      setGroupActive: (symbol, active) =>
        set((s) => {
          const group = s.strategies.filter((x) => !x.isTemplate && x.symbol === symbol);
          // If active is unspecified, flip: any on → all off; all off → all on
          const target = active ?? !group.some((x) => x.isActive ?? false);
          return {
            strategies: s.strategies.map((x) =>
              !x.isTemplate && x.symbol === symbol ? { ...x, isActive: target } : x,
            ),
          };
        }),

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

      copyGroupToSymbol: (fromSymbol, targetSymbol) => {
        const sym = targetSymbol.toUpperCase().trim();
        let cloned = 0;
        set((s) => {
          const sources = s.strategies.filter(
            (x) => !x.isTemplate && x.symbol === fromSymbol,
          );
          if (!sym || sym === fromSymbol || sources.length === 0) return {};
          const copies = sources.map((original) => ({
            ...original,
            id:        `strategy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            symbol:    sym,
            version:   1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isActive:  false,
          }));
          cloned = copies.length;
          // Select the first copy so the user lands somewhere useful
          return {
            strategies:       [...s.strategies, ...copies],
            activeStrategyId: copies[0]?.id ?? s.activeStrategyId,
          };
        });
        return cloned;
      },

      loadStarterTemplates: () =>
        set((s) => {
          const now = Date.now();
          // Stamp createdAt/updatedAt on first load (they're 0 in the constant).
          const stamped = STARTER_TEMPLATES.map((t) => ({
            ...t,
            createdAt: t.createdAt === 0 ? now : t.createdAt,
            updatedAt: now,
          }));
          // Upsert by id: drop any existing entry with the same id, then append.
          const starterIds = new Set(stamped.map((t) => t.id));
          return {
            strategies: [
              ...s.strategies.filter((x) => !starterIds.has(x.id)),
              ...stamped,
            ],
          };
        }),

      cloneStrategyToSymbol: (id, targetSymbol) =>
        set((s) => {
          const original = s.strategies.find((x) => x.id === id);
          if (!original) return {};
          const sym = targetSymbol.toUpperCase().trim();
          if (!sym || sym === original.symbol) return {};
          const now = Date.now();
          const copy: typeof original = {
            ...original,
            id:        `strategy_${now}_${Math.random().toString(36).slice(2, 6)}`,
            symbol:    sym,
            version:   1,
            createdAt: now,
            updatedAt: now,
            isActive:  false,
          };
          return {
            strategies:       [...s.strategies, copy],
            activeStrategyId: copy.id,
          };
        }),

      cloneFromTemplate: (templateId) =>
        set((s) => {
          const template = s.strategies.find((x) => x.id === templateId && x.isTemplate);
          if (!template) return {};
          const now = Date.now();
          const clone: typeof template = {
            ...template,
            id:         `strategy_${now}`,
            name:       `Copy of ${template.name}`,
            version:    1,
            createdAt:  now,
            updatedAt:  now,
            isActive:   false,
            isTemplate: false, // becomes a regular working strategy
          };
          return {
            strategies:       [...s.strategies, clone],
            activeStrategyId: clone.id,
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
