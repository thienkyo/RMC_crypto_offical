/**
 * Client-safe signal types and metrics.
 *
 * This file has ZERO server-side imports — no DB, no pg, no Node.js APIs.
 * It can be safely imported by Client Components.
 *
 * Server-side DB helpers live in src/lib/db/signals.ts.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** One condition inside a snapshot group. */
export interface ConditionSnapshotItem {
  label:   string;
  passed:  boolean;
  value?:  number;   // indicator value at fire time (undefined for pattern indicators)
}

/** One condition group as recorded when the signal fired. */
export interface ConditionSnapshotGroup {
  label?:            string;           // optional group label
  groupOperator:     'or' | 'and';
  conditionOperator: 'and' | 'or';
  conditions:        ConditionSnapshotItem[];
}

export interface StrategySignalRow {
  id:                 number;
  strategy_id:        string;
  strategy_name:      string;
  symbol:             string;
  timeframe:          string;
  direction:          'long' | 'short';
  entry_price:        number;
  stop_loss_pct:      number;
  take_profit_pct:    number;
  candle_time:        number; // Unix ms
  fired_at:           number; // Unix ms
  conditions_snapshot: ConditionSnapshotGroup[] | null; // frozen at fire time
  actual_entry_price:  number | null; // user's actual Binance buy price
  actual_exit_price:   number | null; // user's actual Binance exit price
  pnl_pct:            number | null; // computed from actual prices; null = still open
  outcome_note:       string | null;
  outcome_at:         number | null; // Unix ms
  telegram_delivered: boolean;
}

export interface SignalMetrics {
  total:    number;
  open:     number; // pnl_pct is null
  wins:     number; // pnl_pct > 0
  losses:   number; // pnl_pct < 0
  winRate:  number; // wins / (wins + losses) * 100, or 0
  avgWin:   number; // average pnl_pct of winning trades
  avgLoss:  number; // average pnl_pct of losing trades (negative)
  totalPnl: number; // sum of all recorded pnl_pct
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/** Compute win/loss metrics from a list of signal rows. Pure function — no DB call. */
export function computeSignalMetrics(signals: StrategySignalRow[]): SignalMetrics {
  const closed = signals.filter((s) => s.pnl_pct !== null);
  const wins   = closed.filter((s) => s.pnl_pct! > 0);
  const losses = closed.filter((s) => s.pnl_pct! < 0);
  const open   = signals.filter((s) => s.pnl_pct === null);

  const avg = (arr: StrategySignalRow[]) =>
    arr.length > 0
      ? arr.reduce((sum, s) => sum + s.pnl_pct!, 0) / arr.length
      : 0;

  const winRate  = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalPnl = closed.reduce((sum, s) => sum + s.pnl_pct!, 0);

  return {
    total:    signals.length,
    open:     open.length,
    wins:     wins.length,
    losses:   losses.length,
    winRate,
    avgWin:   avg(wins),
    avgLoss:  avg(losses),
    totalPnl,
  };
}
