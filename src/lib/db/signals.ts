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
export type { StrategySignalRow, SignalMetrics } from '@/lib/strategy/signalMetrics';
export { computeSignalMetrics } from '@/lib/strategy/signalMetrics';
import type { StrategySignalRow } from '@/lib/strategy/signalMetrics';

export interface LogSignalInput {
  strategyId:       string;
  strategyName:     string;
  symbol:           string;
  timeframe:        string;
  direction:        'long' | 'short';
  entryPrice:       number;
  stopLossPct:      number;
  takeProfitPct:    number;
  candleTime:       number; // Unix ms
  telegramDelivered: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a new signal row. Returns the newly created id. */
export async function logStrategySignal(input: LogSignalInput): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO strategy_signals
       (strategy_id, strategy_name, symbol, timeframe, direction,
        entry_price, stop_loss_pct, take_profit_pct, candle_time, telegram_delivered)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::bigint / 1000.0),$10)
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
    ],
  );
  return rows[0]!.id;
}

/** Fetch all signals for a strategy, newest first. */
export async function getSignalsForStrategy(strategyId: string): Promise<StrategySignalRow[]> {
  const { rows } = await db.query<{
    id:                 number;
    strategy_id:        string;
    strategy_name:      string;
    symbol:             string;
    timeframe:          string;
    direction:          string;
    entry_price:        string;
    stop_loss_pct:      string;
    take_profit_pct:    string;
    candle_time:        Date;
    fired_at:           Date;
    pnl_pct:            string | null;
    outcome_note:       string | null;
    outcome_at:         Date | null;
    telegram_delivered: boolean;
  }>(
    `SELECT id, strategy_id, strategy_name, symbol, timeframe, direction,
            entry_price, stop_loss_pct, take_profit_pct,
            candle_time, fired_at, pnl_pct, outcome_note, outcome_at,
            telegram_delivered
     FROM strategy_signals
     WHERE strategy_id = $1
     ORDER BY fired_at DESC`,
    [strategyId],
  );

  return rows.map((r) => ({
    id:                 r.id,
    strategy_id:        r.strategy_id,
    strategy_name:      r.strategy_name,
    symbol:             r.symbol,
    timeframe:          r.timeframe,
    direction:          r.direction as 'long' | 'short',
    entry_price:        parseFloat(r.entry_price),
    stop_loss_pct:      parseFloat(r.stop_loss_pct),
    take_profit_pct:    parseFloat(r.take_profit_pct),
    candle_time:        r.candle_time.getTime(),
    fired_at:           r.fired_at.getTime(),
    pnl_pct:            r.pnl_pct !== null ? parseFloat(r.pnl_pct) : null,
    outcome_note:       r.outcome_note,
    outcome_at:         r.outcome_at ? r.outcome_at.getTime() : null,
    telegram_delivered: r.telegram_delivered,
  }));
}

/** Update the outcome (P&L %) for a signal. Pass null to clear the outcome. */
export async function updateSignalOutcome(
  id: number,
  pnlPct: number | null,
  note?: string,
): Promise<void> {
  await db.query(
    `UPDATE strategy_signals
     SET pnl_pct      = $2,
         outcome_note = $3,
         outcome_at   = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE NULL END
     WHERE id = $1`,
    [id, pnlPct ?? null, note ?? null],
  );
}

/** Delete a signal row permanently. */
export async function deleteSignal(id: number): Promise<void> {
  await db.query(`DELETE FROM strategy_signals WHERE id = $1`, [id]);
}

// computeSignalMetrics, SignalMetrics, and StrategySignalRow are
// re-exported from src/lib/strategy/signalMetrics.ts above.
