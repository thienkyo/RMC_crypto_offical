/**
 * Signal record — one row from strategy_signals, excluding the SERIAL `id`.
 *
 * All NUMERIC columns come back as strings from the `pg` driver.
 * Timestamps come back as ISO 8601 strings when serialised to JSON.
 */
export interface SignalRecord {
  strategy_id:          string;
  strategy_name:        string;
  symbol:               string;
  timeframe:            string;
  direction:            'long' | 'short';
  entry_price:          string;
  stop_loss_pct:        string;
  take_profit_pct:      string;
  /** ISO 8601 — the candle bar that triggered the signal. */
  candle_time:          string;
  /** ISO 8601 — when the cron actually fired this signal. */
  fired_at:             string;
  conditions_snapshot:  unknown | null;
  actual_entry_price:   string | null;
  actual_exit_price:    string | null;
  pnl_pct:              string | null;
  outcome_note:         string | null;
  outcome_at:           string | null;
  telegram_delivered:   boolean;
}
