/**
 * useLiveStrategies — evaluates ALL active strategies against live candle data.
 *
 * Behaviour:
 *   • Finds every strategy with `isActive === true` whose symbol + timeframe
 *     matches the current chart view.
 *   • Runs a mini-backtest over the last MAX_CANDLES closed candles whenever a
 *     new bar closes (candles.length increments).  Deliberately NOT re-evaluated
 *     on every live tick — signals are based on closed bars only.
 *   • Returns one LiveStrategyState per active strategy so the caller can paint
 *     per-strategy chart markers and per-strategy header badges.
 *
 * Performance: runBacktest over 200 candles with 3–5 indicators takes < 5ms per
 * strategy.  Bar closes happen at most once per minute (1m TF), so CPU impact is
 * negligible even with several strategies running simultaneously.
 */

import { useMemo } from 'react';
import { useChartStore }    from '@/store/chart';
import { useStrategyStore } from '@/store/strategy';
import { runBacktest }      from '@/lib/strategy/backtester';
import type { Strategy, BacktestTrade } from '@/types/strategy';

/**
 * How many of the most recent candles to use for indicator computation.
 * Must match (or exceed) the window useBacktest fetches (1 000) so that
 * EMA-based indicators warm up identically and signals fire on the same bars.
 * The chart store holds SERVE_LIMIT candles per timeframe (≥ 1 000 for all TFs),
 * so slicing to 1 000 is always safe and keeps CPU time under ~10 ms.
 */
const MAX_CANDLES = 1_000;

export interface LiveStrategyState {
  /** The strategy being monitored. */
  strategy:   Strategy;
  /** All trades fired within the last MAX_CANDLES bars. */
  trades:     BacktestTrade[];
  /**
   * Whether the strategy is currently in a simulated position.
   * True when the last trade has no exit yet (end_of_data exit = still open).
   */
  inPosition: boolean;
  /** The most recent entry or exit trade, for the header badge. */
  lastSignal: BacktestTrade | null;
}

/**
 * Returns one LiveStrategyState for every active strategy that matches the
 * current chart's symbol + timeframe.  Empty array when none are active.
 */
export function useLiveStrategies(): LiveStrategyState[] {
  const candles    = useChartStore((s) => s.candles);
  const symbol     = useChartStore((s) => s.symbol);
  const timeframe  = useChartStore((s) => s.timeframe);
  const strategies = useStrategyStore((s) => s.strategies);

  // All active strategies matching this chart's symbol + timeframe.
  // Stable reference via useMemo so the outer memo doesn't churn on every tick.
  const activeStrategies = useMemo(
    () =>
      strategies.filter(
        (s) => (s.isActive ?? false) && s.symbol === symbol && s.timeframe === timeframe,
      ),
    [strategies, symbol, timeframe],
  );

  // Bar-close count — only increments when a new candle is appended.
  // Using this as the memo dependency ensures we only recompute on bar close,
  // not on every live tick update (which would be wasteful).
  const barCloseCount = candles.length;

  return useMemo((): LiveStrategyState[] => {
    if (activeStrategies.length === 0 || barCloseCount < 2) return [];

    // candles[length-1] is the currently FORMING bar; include it so the most
    // recent closed bar (length-2) is always in the window.
    const window = candles.slice(-MAX_CANDLES);

    return activeStrategies.map((strategy): LiveStrategyState => {
      let trades: BacktestTrade[] = [];
      try {
        trades = runBacktest(strategy, window).trades;
      } catch (err) {
        console.error(`[useLiveStrategies:${strategy.id}] runBacktest failed:`, err);
      }
      const lastSignal = trades.length > 0 ? trades[trades.length - 1]! : null;
      // inPosition: true when at least one position is still open at end of data.
      // With maxPositions > 1 multiple concurrent positions may be open.
      const inPosition = trades.some((t) => t.exitReason === 'end_of_data');
      return { strategy, trades, inPosition, lastSignal };
    });

    // candles is captured via closure — intentionally omitted from deps so we
    // only recompute when a new bar closes (barCloseCount) or the active
    // strategy list changes (activeStrategies).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategies, barCloseCount]);
}

/**
 * Convenience wrapper — returns the first active strategy's state, or a
 * null-state if none is active.  Use useLiveStrategies() when you need all.
 */
export function useLiveStrategy() {
  const all   = useLiveStrategies();
  const first = all[0] ?? null;
  return {
    strategy:   first?.strategy   ?? null,
    trades:     first?.trades     ?? [],
    inPosition: first?.inPosition ?? false,
    lastSignal: first?.lastSignal ?? null,
  };
}
