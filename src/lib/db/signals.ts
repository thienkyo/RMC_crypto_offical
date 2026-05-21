/**
 * DB helpers for strategy_signals table.
 *
 * One row per cron-fired entry signal that was delivered via Telegram.
 * Outcomes (pnl_pct) are filled in manually via the UI.
 *
 * NOTE: Keep this file server-side only — it imports `pg` via db/client.
 * Client-safe types and computeSignalMetrics live in
 * src/lib/strategy/signalMetrics.ts.
 */
import { db } from '@/lib/db/client';
export type { StrategySignalRow, SignalMetrics, ConditionSnapshotGroup } from '@/lib/strategy/signalMetrics';
export { computeSignalMetrics } from '@/lib/strategy/signalMetrics';
import type { StrategySignalRow, ConditionSnapshotGroup } from '@/lib/strategy/signalMetrics';

export interface LogSignalInput {
  strategyId:          string;
  strategyName:        string;
  symbol:              string;
  timeframe:           string;
  direction:           'long' | 'short';
  entryPrice:          number;
  stopLossPct:         number;
  takeProfitPct:       number;
  candleTime:          number; // Unix ms
  telegramDelivered:   boolean;
  /** Frozen snapshot of conditions + their indicator values at fire time. */
  conditionsSnapshot?: ConditionSnapshotGroup[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a new signal row. Returns the newly created id. */
export async function logStrategySignal(input: LogSignalInput): Promise<number> {
  const snapshot = input.conditionsSnapshot
    ? JSON.stringify(input.conditionsSnapshot)
    : null;

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO strategy_signals
       (strategy_id, strategy_name, symbol, timeframe, direction,
        entry_price, stop_loss_pct, take_profit_pct, candle_time,
        telegram_delivered, conditions_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::bigint / 1000.0),$10,$11)
     RETURNING id`,
    [
      input.strategyId,
      input.strategyName,
      input.symbol,
      input.timeframe,
      input.direction,
      input.entryPrice,
      input.stopLossPct,
      input.takeProfitPct,
      input.candleTime,
      input.telegramDelivered,
      snapshot,
    ],
  );
  return rows[0]!.id;
}

/** Fetch every signal across all strategies, newest first. Used by the Portfolio view. */
export async function getAllSignals(): Promise<StrategySignalRow[]> {
  const { rows } = await db.query<{
    id:                  number;
    strategy_id:         string;
    strategy_name:       string;
    symbol:              string;
    timeframe:           string;
    direction:           string;
    entry_price:         string;
    stop_loss_pct:       string;
    take_profit_pct:     string;
    candle_time:         Date;
    fired_at:            Date;
    conditions_snapshot: ConditionSnapshotGroup[] | null;
    actual_entry_price:  string | null;
    actual_exit_price:   string | null;
    pnl_pct:             string | null;
    outcome_note:        string | null;
    outcome_at:          Date | null;
    telegram_delivered:  boolean;
  }>(
    `SELECT id, strategy_id, strategy_name, symbol, timeframe, direction,
            entry_price, stop_loss_pct, take_profit_pct,
            candle_time, fired_at,
            conditions_snapshot,
            actual_entry_price, actual_exit_price,
            pnl_pct, outcome_note, outcome_at,
            telegram_delivered
     FROM strategy_signals
     ORDER BY fired_at DESC`,
  );

  return rows.map((r) => ({
    id:                  r.id,
    strategy_id:         r.strategy_id,
    strategy_name:       r.strategy_name,
    symbol:              r.symbol,
    timeframe:           r.timeframe,
    direction:           r.direction as 'long' | 'short',
    entry_price:         parseFloat(r.entry_price),
    stop_loss_pct:       parseFloat(r.stop_loss_pct),
    take_profit_pct:     parseFloat(r.take_profit_pct),
    candle_time:         r.candle_time.getTime(),
    fired_at:            r.fired_at.getTime(),
    conditions_snapshot: r.conditions_snapshot ?? null,
    actual_entry_price:  r.actual_entry_price !== null ? parseFloat(r.actual_entry_price) : null,
    actual_exit_price:   r.actual_exit_price  !== null ? parseFloat(r.actual_exit_price)  : null,
    pnl_pct:             r.pnl_pct !== null ? parseFloat(r.pnl_pct) : null,
    outcome_note:        r.outcome_note,
    outcome_at:          r.outcome_at ? r.outcome_at.getTime() : null,
    telegram_delivered:  r.telegram_delivered,
  }));
}

/** Fetch all signals for a strategy, newest first. */
export async function getSignalsForStrategy(strategyId: string): Promise<StrategySignalRow[]> {
  const { rows } = await db.query<{
    id:                  number;
    strategy_id:         string;
    strategy_name:       string;
    symbol:              string;
    timeframe:           string;
    direction:           string;
    entry_price:         string;
    stop_loss_pct:       string;
    take_profit_pct:     string;
    candle_time:         Date;
    fired_at:            Date;
    conditions_snapshot: ConditionSnapshotGroup[] | null;
    actual_entry_price:  string | null;
    actual_exit_price:   string | null;
    pnl_pct:             string | null;
    outcome_note:        string | null;
    outcome_at:          Date | null;
    telegram_delivered:  boolean;
  }>(
    `SELECT id, strategy_id, strategy_name, symbol, timeframe, direction,
            entry_price, stop_loss_pct, take_profit_pct,
            candle_time, fired_at,
            conditions_snapshot,
            actual_entry_price, actual_exit_price,
            pnl_pct, outcome_note, outcome_at,
            telegram_delivered
     FROM strategy_signals
     WHERE strategy_id = $1
     ORDER BY fired_at DESC`,
    [strategyId],
  );

  return rows.map((r) => ({
    id:                  r.id,
    strategy_id:         r.strategy_id,
    strategy_name:       r.strategy_name,
    symbol:              r.symbol,
    timeframe:           r.timeframe,
    direction:           r.direction as 'long' | 'short',
    entry_price:         parseFloat(r.entry_price),
    stop_loss_pct:       parseFloat(r.stop_loss_pct),
    take_profit_pct:     parseFloat(r.take_profit_pct),
    candle_time:         r.candle_time.getTime(),
    fired_at:            r.fired_at.getTime(),
    conditions_snapshot: r.conditions_snapshot ?? null,
    actual_entry_price:  r.actual_entry_price !== null ? parseFloat(r.actual_entry_price) : null,
    actual_exit_price:   r.actual_exit_price  !== null ? parseFloat(r.actual_exit_price)  : null,
    pnl_pct:             r.pnl_pct !== null ? parseFloat(r.pnl_pct) : null,
    outcome_note:        r.outcome_note,
    outcome_at:          r.outcome_at ? r.outcome_at.getTime() : null,
    telegram_delivered:  r.telegram_delivered,
  }));
}

/**
 * Update the actual trade prices for a signal.
 * pnl_pct is auto-computed from actual_entry_price + actual_exit_price when both are set.
 * Pass null for both prices to clear the outcome entirely.
 */
export async function updateSignalOutcome(
  id:               number,
  actualEntryPrice: number | null,
  actualExitPrice:  number | null,
  direction:        'long' | 'short',
  note?:            string,
): Promise<void> {
  // Compute P&L only when both prices are present
  let pnlPct: number | null = null;
  if (actualEntryPrice !== null && actualExitPrice !== null && actualEntryPrice > 0) {
    pnlPct = direction === 'long'
      ? (actualExitPrice - actualEntryPrice) / actualEntryPrice * 100
      : (actualEntryPrice - actualExitPrice) / actualEntryPrice * 100;
  }

  await db.query(
    `UPDATE strategy_signals
     SET actual_entry_price = $2,
         actual_exit_price  = $3,
         pnl_pct            = $4::NUMERIC,
         outcome_note       = $5,
         outcome_at         = CASE WHEN $4::NUMERIC IS NOT NULL THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [id, actualEntryPrice ?? null, actualExitPrice ?? null, pnlPct, note ?? null],
  );
}

/** Delete a signal row permanently. */
export async function deleteSignal(id: number): Promise<void> {
  await db.query(`DELETE FROM strategy_signals WHERE id = $1`, [id]);
}

// computeSignalMetrics, SignalMetrics, and StrategySignalRow are
// re-exported from src/lib/strategy/signalMetrics.ts above.
