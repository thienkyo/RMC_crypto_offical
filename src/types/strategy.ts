import type { Timeframe } from './market';

// ── Condition types ────────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'gt'            // current value > threshold
  | 'lt'            // current value < threshold
  | 'gte'           // current value >= threshold
  | 'lte'           // current value <= threshold
  | 'crosses_above' // prev bar <= threshold, current bar > threshold
  | 'crosses_below'; // prev bar >= threshold, current bar < threshold

/**
 * A single condition: "[indicator series] [operator] [value]"
 * e.g. "RSI(14) < 30" or "MACD Line crosses above 0"
 */
export interface StrategyCondition {
  /** Unique within the strategy (nanoid or Date.now string). */
  id: string;
  /** Key in the INDICATORS registry — 'ema' | 'sma' | 'rsi' | 'macd' | 'bollinger'. */
  indicatorId: string;
  /** Params forwarded to indicator.compute(), e.g. { period: 14, emaPeriod: 0 }. */
  params: Record<string, number>;
  /**
   * 0-based index into the IndicatorResult array produced by compute().
   * Most single-series indicators → 0.
   * MACD: 0 = MACD Line, 1 = Signal, 2 = Histogram.
   * Bollinger: 0 = Middle, 1 = Upper, 2 = Lower.
   * RSI: 0 = RSI, 1 = EMA of RSI (when emaPeriod > 0).
   */
  seriesIndex: number;
  operator: ConditionOperator;
  /** Fixed numeric threshold on the right-hand side. */
  value: number;
  /**
   * How this condition is checked by the notification cron.
   *
   * 'confirmation' (default): this condition must be true on ALL of the last
   *   `checkCandles` consecutive closed candles before the alert fires.
   *
   * 'lookback': fire if this condition was true on ANY of the last
   *   `checkCandles` closed candles (catches recently-missed signals).
   */
  checkMode?: 'confirmation' | 'lookback';
  /** Number of candles used by checkMode. Default 1. */
  checkCandles?: number;
  /**
   * When false the condition is skipped entirely during evaluation — treated as
   * if it were not in the group. Its config values are preserved so it can be
   * re-enabled without re-entering everything. Defaults to true when absent.
   */
  enabled?: boolean;
}

/**
 * A group of conditions — ALL must be satisfied (AND logic within group).
 * Between groups it is OR logic (any group firing triggers the action).
 */
export interface ConditionGroup {
  id: string;
  /** Optional human label, e.g. "Oversold zone". */
  label: string;
  conditions: StrategyCondition[];
}

// ── Action types ──────────────────────────────────────────────────────────────

export type ActionType = 'enter_long' | 'enter_short';

export interface StrategyAction {
  type: ActionType;
  /** Percentage of portfolio capital to allocate per position (1–100). */
  positionSizePct: number;
  /**
   * Maximum simultaneous open positions.
   * 1 = classic single-position mode (default).
   * > 1 = open a new position each time entry fires, up to this cap.
   * Tip: set positionSizePct = 100 / maxPositions to stay fully invested.
   */
  maxPositions: number;
}

export interface RiskManagement {
  /** Stop-loss as % adverse move from entry. 0 = disabled. */
  stopLossPct: number;
  /** Take-profit as % favourable move from entry. 0 = disabled. */
  takeProfitPct: number;
}

// ── Strategy document ─────────────────────────────────────────────────────────

export interface Strategy {
  id: string;
  /** Short identifier shown in the UI strategy list. */
  name: string;
  /**
   * Verbose name used in Telegram alert messages.
   * Falls back to `name` when blank or absent.
   * Example: "RSI oversold + EMA crossover on 4h BTC — high confidence"
   */
  longName?: string;
  description: string;
  /** Incremented on every explicit Save. Used for versioning. */
  version: number;
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
  symbol: string;    // e.g. 'BTCUSDT'
  timeframe: Timeframe;
  /** When true, evaluated live on the chart and entry/exit markers are painted. */
  isActive: boolean;
  /**
   * When true this is a reusable template — it cannot be activated or monitored
   * directly. Clone it to create a regular working strategy.
   */
  isTemplate?: boolean;
  /**
   * Entry fires when ANY group is fully satisfied (OR between groups, AND within).
   * Empty → strategy never enters.
   */
  entryConditions: ConditionGroup[];
  /**
   * Exit fires when ANY group is fully satisfied.
   * May be empty — in that case only SL/TP closes positions.
   */
  exitConditions: ConditionGroup[];
  action: StrategyAction;
  risk: RiskManagement;
  /**
   * When true, the server-side cron syncs this strategy to DB and fires a
   * Telegram message whenever a new entry signal is detected.
   * Requires the strategy to also be saved (synced to DB via /api/strategies).
   */
  notifyOnSignal?: boolean;
}

// ── Backtest output types ─────────────────────────────────────────────────────

export type ExitReason = 'signal' | 'stop_loss' | 'take_profit' | 'end_of_data';

export interface BacktestTrade {
  id: number;
  entryTime: number;  // Unix ms
  exitTime: number;   // Unix ms
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  positionSizePct: number;
  /** Percentage P&L on the allocated slice of capital. */
  pnlPct: number;
  /** Absolute P&L in quote currency against full portfolio at entry. */
  pnlAbs: number;
  exitReason: ExitReason;
}

export interface EquityPoint {
  time: number;  // Unix ms
  value: number; // Portfolio value in quote currency
}

export interface BacktestMetrics {
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Gross profit / gross loss. Infinity if no losing trades, 0 if no winning trades. */
  profitFactor: number;
  maxDrawdownPct: number;
  /** Annualised Sharpe ratio (0 risk-free rate). */
  sharpeRatio: number;
  /** Annualised Sortino ratio (penalises downside vol only). */
  sortinoRatio: number;
  initialCapital: number;
  finalCapital: number;
}

export interface BacktestResult {
  strategyId: string;
  symbol: string;
  timeframe: Timeframe;
  ranAt: number;     // Unix ms timestamp of when the backtest was run
  startTime: number; // Earliest candle openTime
  endTime: number;   // Latest candle closeTime
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}
