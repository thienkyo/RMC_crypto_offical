/**
 * Alert evaluator — server-side, used by the check-alerts cron endpoint.
 *
 * For each enabled alert rule:
 *  1. Skip if within the cooldown window (last_fired_at + cooldown_ms > now).
 *  2. Fetch the most recent closed candles from DB (enough for indicator warmup).
 *  3. Evaluate the condition on the LAST CLOSED bar (index length-2; length-1 is forming).
 *  4. Return fired:true with a formatted message, or fired:false with a skip reason.
 *
 * Special indicator ID '__price__':
 *   Compares the last closed bar's close price against the condition value.
 *   No indicator warmup required; seriesIndex and params are ignored.
 */

import { db } from '@/lib/db/client';
import { buildIndicatorCache, evaluateCondition } from '@/lib/strategy/evaluate';
import { fetchKlines, TF_TO_MS } from '@/lib/exchange/binance';
import { formatAlertMessage } from './telegram';
import type { AlertRule, AlertEvalResult } from '@/types/alert';
import type { Candle, Timeframe } from '@/types/market';

/** Enough candles for EMA(200) warmup plus some buffer. */
const EVAL_CANDLE_WINDOW = 300;

/**
 * Evaluate a single alert rule against the latest DB candles.
 * Never throws — errors are captured as fired:false / reason:'error'.
 */
export async function evaluateAlertRule(rule: AlertRule): Promise<AlertEvalResult> {
  // ── 1. Cooldown check ─────────────────────────────────────────────────────
  if (rule.lastFiredAt !== null) {
    if (Date.now() - rule.lastFiredAt < rule.cooldownMs) {
      return { fired: false, rule, reason: 'cooldown' };
    }
  }

  // ── 2. Fetch latest closed candles from DB ────────────────────────────────
  let candles: Candle[];
  try {
    candles = await fetchLatestCandles(rule.symbol, rule.timeframe, EVAL_CANDLE_WINDOW);
  } catch (err) {
    console.error(`[alerts/evaluate] DB fetch failed for ${rule.symbol}/${rule.timeframe}:`, err);
    return { fired: false, rule, reason: 'error' };
  }

  if (candles.length < 2) {
    return { fired: false, rule, reason: 'no_candles' };
  }

  // candles[length-1] is the forming bar; candles[length-2] is the last closed.
  const closedCandles = candles.slice(0, -1);
  const lastClosed    = closedCandles[closedCandles.length - 1]!;
  const prevClosed    = closedCandles[closedCandles.length - 2];
  const condition     = rule.condition;

  // ── 3. Evaluate the condition ─────────────────────────────────────────────
  try {
    let conditionMet: boolean;
    let currentValue: number;

    if (condition.indicatorId === '__price__') {
      currentValue = lastClosed.close;
      conditionMet = evaluateSimpleOp(currentValue, condition.operator, condition.value);
    } else {
      const cache  = buildIndicatorCache([condition], closedCandles);
      conditionMet = evaluateCondition(condition, lastClosed, prevClosed, cache);

      const key    = `${condition.indicatorId}|${condition.seriesIndex}|${JSON.stringify(condition.params)}`;
      const timeMap = (cache as Map<string, Map<number, number>>).get(key);
      currentValue  = timeMap?.get(lastClosed.openTime) ?? NaN;
    }

    if (!conditionMet) {
      return { fired: false, rule, reason: 'condition_false' };
    }

    // ── 4. Build message matching the indicator alert template ────────────
    const message = formatAlertMessage({
      symbol:        rule.symbol,
      timeframe:     rule.timeframe,
      indicatorName: indicatorName(condition),
      triggerDesc:   triggerDesc(condition),
      currentValue,
      price:         lastClosed.close,
      timestamp:     lastClosed.openTime,
    });

    return { fired: true, rule, message };

  } catch (err) {
    console.error(`[alerts/evaluate] Condition eval failed for rule ${rule.id}:`, err);
    return { fired: false, rule, reason: 'error' };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchLatestCandles(
  symbol:    string,
  timeframe: string,
  limit:     number,
): Promise<Candle[]> {
  const { rows } = await db.query<{
    open_time:  Date;
    open:       string;
    high:       string;
    low:        string;
    close:      string;
    volume:     string;
    close_time: Date;
  }>(
    `SELECT open_time, open, high, low, close, volume, close_time
     FROM candles
     WHERE symbol = $1 AND timeframe = $2
     ORDER BY open_time DESC
     LIMIT $3`,
    [symbol, timeframe, limit],
  );
  const dbCandles = rows.reverse().map((r) => ({
    openTime:  r.open_time.getTime(),
    open:      parseFloat(r.open),
    high:      parseFloat(r.high),
    low:       parseFloat(r.low),
    close:     parseFloat(r.close),
    volume:    parseFloat(r.volume),
    closeTime: r.close_time.getTime(),
  }));

  // Fetch a fresh tail from Binance to avoid evaluating stale DB data
  try {
    const dbTailTime = dbCandles.length > 0 ? dbCandles[dbCandles.length - 1]!.openTime : 0;
    const tfMs = TF_TO_MS[timeframe as Timeframe];
    const missingCandles = dbTailTime > 0 ? Math.ceil((Date.now() - dbTailTime) / tfMs) + 5 : limit;
    const fetchLimit = Math.min(limit, Math.max(5, missingCandles));

    const freshTail = await fetchKlines(
      symbol,
      timeframe as Timeframe,
      fetchLimit,
      undefined,
      true, // noCache
    );

    if (freshTail.length === 0) return dbCandles;

    const freshStart = freshTail[0]!.openTime;
    const base = dbCandles.filter((c) => c.openTime < freshStart);
    const merged = [...base, ...freshTail];

    return merged;
  } catch (err) {
    console.warn(`[alerts/evaluate] Binance tail fetch failed for ${symbol}/${timeframe}:`, err);
    return dbCandles;
  }
}

function evaluateSimpleOp(current: number, operator: string, value: number): boolean {
  switch (operator) {
    case 'gt':  return current > value;
    case 'lt':  return current < value;
    case 'gte': return current >= value;
    case 'lte': return current <= value;
    default:    return false; // crosses_* require history — not meaningful for price snapshots
  }
}

/** "RSI(14)" or "MACD(12,26,9)" or "Price" */
function indicatorName(condition: AlertRule['condition']): string {
  if (condition.indicatorId === '__price__') return 'Price';
  const paramStr = Object.values(condition.params).join(',');
  const series   = condition.seriesIndex > 0 ? `[${condition.seriesIndex}]` : '';
  return `${condition.indicatorId.toUpperCase()}(${paramStr})${series}`;
}

/**
 * "RSI crossed below 30", "Price above 70000", "MACD(12,26,9) crossed above 0"
 * Used as the Trigger line in the indicator alert template.
 */
function triggerDesc(condition: AlertRule['condition']): string {
  const name = indicatorName(condition);
  const phrases: Record<string, string> = {
    gt:            'above',
    lt:            'below',
    gte:           'at or above',
    lte:           'at or below',
    crosses_above: 'crossed above',
    crosses_below: 'crossed below',
  };
  const phrase = phrases[condition.operator] ?? condition.operator;
  return `${name} ${phrase} ${condition.value}`;
}

/**
 * Short condition string used in strategy signal "Conditions met" list.
 * e.g. "RSI(14) < 35", "EMA(20) crosses above 0"
 * Exported so notify.ts can reuse it.
 */
export function conditionLabel(c: { indicatorId: string; params: Record<string, number>; seriesIndex: number; operator: string; value: number }): string {
  const opSym: Record<string, string> = {
    gt:            '>',
    lt:            '<',
    gte:           '>=',
    lte:           '<=',
    crosses_above: 'crosses above',
    crosses_below: 'crosses below',
  };
  const op = opSym[c.operator] ?? c.operator;
  if (c.indicatorId === '__price__') return `Price ${op} ${c.value}`;
  const paramStr = Object.values(c.params).join(',');
  const series   = c.seriesIndex > 0 ? `[${c.seriesIndex}]` : '';
  return `${c.indicatorId.toUpperCase()}(${paramStr})${series} ${op} ${c.value}`;
}
