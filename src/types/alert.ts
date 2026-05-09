import type { StrategyCondition } from './strategy';
import type { Timeframe } from './market';

/**
 * An AlertCondition is exactly a StrategyCondition.
 * We alias it here for clarity; the evaluate.ts logic works on both.
 *
 * Special case: indicatorId === '__price__' means "current close price".
 * params is ignored; seriesIndex is ignored; operator + value are used normally.
 */
export type AlertCondition = StrategyCondition;

/**
 * A persisted alert rule from the `alert_rules` DB table.
 */
export interface AlertRule {
  id: string;
  name: string;
  symbol: string;
  timeframe: Timeframe;
  enabled: boolean;
  condition: AlertCondition;
  /** Minimum ms between firings of this rule. Default: 3 600 000 (1 hour). */
  cooldownMs: number;
  /** Unix ms of the last time this rule fired, or null if never. */
  lastFiredAt: number | null;
  createdAt: number; // Unix ms
  updatedAt: number; // Unix ms
}

/**
 * Payload for POST /api/alerts — creates a new rule.
 */
export interface CreateAlertInput {
  name: string;
  symbol: string;
  timeframe: Timeframe;
  condition: AlertCondition;
  cooldownMs?: number;
}

/**
 * Payload for PATCH /api/alerts — updates an existing rule.
 */
export interface UpdateAlertInput {
  id: string;
  name?: string;
  enabled?: boolean;
  condition?: AlertCondition;
  cooldownMs?: number;
}

/**
 * A row from the `alert_history` table.
 */
export interface AlertHistoryEntry {
  id: string;
  ruleId: string;
  firedAt: number; // Unix ms
  message: string;
  delivered: boolean;
}

/**
 * Result returned by the alert evaluator for a single rule.
 */
export type AlertEvalResult =
  | { fired: true;  rule: AlertRule; message: string }
  | { fired: false; rule: AlertRule; reason: 'condition_false' | 'cooldown' | 'no_candles' | 'error' };
