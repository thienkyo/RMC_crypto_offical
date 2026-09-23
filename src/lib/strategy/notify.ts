/**
 * Server-side strategy signal notifier.
 *
 * Called by the check-alerts cron for each strategy with notifyOnSignal = true.
 *
 * Each StrategyCondition carries its own checkMode + checkCandles:
 *
 *   'confirmation' (default), N:
 *     This condition must be true on ALL of the last N consecutive closed candles.
 *
 *   'lookback', N:
 *     This condition must have been true on ANY of the last N closed candles.
 *
 * A condition group fires when ALL its conditions pass their individual checks (AND).
 * The strategy fires when ANY group fires (OR).
 *
 * Dedup: stamped at the last closed candle's openTime — prevents re-firing within
 * the same candle period regardless of how many cron ticks occur.
 *
 * First-run guard: if lastNotifiedTradeTime is NULL, stamp and skip to avoid
 * blasting historical signals on initial setup.
 */

import { db }                         from '@/lib/db/client';
import { fetchLatestCandlesCached }    from '@/lib/db/candles';
import { buildIndicatorCache,
         conditionCacheKey,
         evaluateConditionChecked,
         evaluateConditionGroupsChecked } from '@/lib/strategy/evaluate';
import { formatStrategySignalMessage }  from '@/lib/alerts/telegram';
import { signalScore }                 from '@/lib/strategy/rating';
import { conditionLabel }              from '@/lib/alerts/evaluate';
import { computeEntryPriceLimit }      from '@/lib/strategy/entryPrice';
import type { Strategy, StrategyCondition } from '@/types/strategy';
import type { Candle, Timeframe }      from '@/types/market';
import type { ConditionSnapshotGroup } from '@/lib/db/signals';

const CANDLE_WINDOW = 1_000;

export type StrategyNotifyResult =
  | { fired: true;  strategy: Strategy; message: string; entryPrice: number; entryPriceLimit: number; rating: number; candleTime: number; conditionGroups: ConditionSnapshotGroup[]; aiEvaluation?: import('@/lib/ai/evaluator/types').OrderEvaluationResult; debug?: StrategyNotifyDebug }
  | { fired: false; strategy: Strategy; reason: 'first_run' | 'dedup_blocked' | 'conditions_not_met' | 'no_candles' | 'error'; debug?: StrategyNotifyDebug };


/** Debug context surfaced in the cron Manual response. */
export interface StrategyNotifyDebug {
  lastClosedOpenTime: string;    // ISO — the candle we evaluated
  lastNotifiedTimeMs: string;    // ISO — what was stamped in DB (or 'null')
  candleCount: number;
  conditionResults?: Array<{ label: string; passed: boolean }>;
}

export async function evaluateStrategySignal(
  strategy: Strategy,
  lastNotifiedTimeMs: number | null,
): Promise<StrategyNotifyResult> {
  // ── 1. Fetch candles (cached & deduplicated) ──────────────────────────────
  let candles: Candle[];
  try {
    candles = await fetchLatestCandlesCached(strategy.symbol, strategy.timeframe, CANDLE_WINDOW);
  } catch (err) {
    console.error(`[strategy/notify] Cached fetch failed for ${strategy.id}:`, err);
    return { fired: false, strategy, reason: 'error' };
  }

  // Only evaluate fully closed candles. We filter explicitly by closeTime to ensure
  // we don't accidentally drop closed candles if Binance API is delayed.
  const now = Date.now();
  const closed = candles.filter((c) => c.closeTime < now);
  if (closed.length < 2) return { fired: false, strategy, reason: 'no_candles' };

  const lastClosed = closed[closed.length - 1]!;

  const baseDebug = {
    lastClosedOpenTime: new Date(lastClosed.openTime).toISOString(),
    lastNotifiedTimeMs: lastNotifiedTimeMs !== null
      ? new Date(lastNotifiedTimeMs).toISOString()
      : 'null',
    candleCount: closed.length,
  };

  // ── 2. First-run guard ─────────────────────────────────────────────────────
  if (lastNotifiedTimeMs === null) {
    await tryStampNotifiedTime(strategy.id, lastClosed.openTime);
    return { fired: false, strategy, reason: 'first_run', debug: baseDebug };
  }

  // ── 3. Dedup gate — same candle period already notified ───────────────────
  if (lastClosed.openTime <= lastNotifiedTimeMs) {
    return { fired: false, strategy, reason: 'dedup_blocked', debug: baseDebug };
  }

  // ── 4. Build indicator cache ───────────────────────────────────────────────
  let cache: Map<string, Map<number, number>>;
  try {
    const allConditions = strategy.entryConditions.flatMap((g) => g.conditions);
    cache = buildIndicatorCache(allConditions, closed);
  } catch (err) {
    console.error(`[strategy/notify] buildIndicatorCache failed for ${strategy.id}:`, err);
    return { fired: false, strategy, reason: 'error', debug: baseDebug };
  }

  // ── 5. Evaluate condition groups ───────────────────────────────────────────
  // Use the canonical evaluation functions to ensure notify logic exactly
  // matches backtester and chart markers.
  const fired = evaluateConditionGroupsChecked(
    strategy.entryConditions,
    closed,
    closed.length - 1,
    cache,
  );

  // Collect per-condition pass/fail for debug output (only for enabled conditions).
  const conditionResults = strategy.entryConditions
    .flatMap((g) => g.conditions)
    .filter((c) => c.enabled !== false)
    .map((c) => ({
      label:  conditionLabel(c),
      passed: conditionPassesCheck(c, closed, cache),
    }));

  const fullDebug = { ...baseDebug, conditionResults };

  if (!fired) return { fired: false, strategy, reason: 'conditions_not_met', debug: fullDebug };

  // ── 6. Atomic stamp — race-condition guard ────────────────────────────────
  // Stamp BEFORE building/sending the message. The UPDATE only succeeds if no
  // other cron process has already stamped this candle (conditional WHERE).
  // If rowCount === 0, we lost the race — bail out silently.
  const stamped = await tryStampNotifiedTime(strategy.id, lastClosed.openTime);
  if (!stamped) {
    console.log(
      `[strategy/notify] dedup (concurrent): ${strategy.name} already stamped for ` +
      new Date(lastClosed.openTime).toISOString(),
    );
    return { fired: false, strategy, reason: 'dedup_blocked', debug: fullDebug };
  }

  // ── 7. Build condition snapshot ────────────────────────────────────────────
  // Include checkCandles + checkMode in the snapshot so signalScore() can
  // compute the confirmation bonus from stored data in future reads.
  const conditionGroups = strategy.entryConditions
    .filter((g) => g.conditions.some((c) => c.enabled !== false))
    .map((g) => ({
      groupOperator:     g.operator ?? 'or',
      conditionOperator: g.conditionOperator ?? (g.operator === 'and' ? 'or' : 'and'),
      label:             g.label,
      conditions:        g.conditions
        .filter((c) => c.enabled !== false)
        .map((c) => {
          const key     = conditionCacheKey(c);
          const timeMap = cache.get(key);
          const value   = timeMap?.get(lastClosed.openTime);
          return {
            label:        conditionLabel(c),
            passed:       conditionPassesCheck(c, closed, cache),
            value,
            checkCandles: c.checkCandles ?? 1,
            checkMode:    c.checkMode    ?? 'confirmation',
          };
        }),
    }));

  // ── 8. Compute per-signal rating + limit entry price ──────────────────────
  const rating     = signalScore(conditionGroups);
  const direction  = strategy.action.type === 'enter_long' ? 'long' : 'short';
  const entryPriceLimit = parseFloat(
    computeEntryPriceLimit(lastClosed.close, strategy.action.entryPriceOffset, direction).toFixed(8),
  );

  // ── 8b. Optional AI Order Evaluation ───────────────────────────────────────
  let aiEvaluation: import('@/lib/ai/evaluator/types').OrderEvaluationResult | undefined;
  try {
    const { isAiSignalGatekeeperEnabled, getAiKey } = await import('@/lib/db/aiSettings');
    const gatekeeperActive = await isAiSignalGatekeeperEnabled();

    if (gatekeeperActive) {
      const [geminiKey, claudeKey, openaiKey] = await Promise.all([
        getAiKey('gemini'),
        getAiKey('claude'),
        getAiKey('chatgpt'),
      ]);

      if (geminiKey || claudeKey || openaiKey) {
        const { evaluateOrder } = await import('@/lib/ai/evaluator/gateway');
        aiEvaluation = await evaluateOrder(
          {
            symbol: strategy.symbol,
            timeframe: strategy.timeframe,
            direction,
            entryPrice: entryPriceLimit ?? lastClosed.close,
            stopLossPct: strategy.risk.stopLossPct,
            takeProfitPct: strategy.risk.takeProfitPct,
            candleTime: lastClosed.openTime,
          },
          closed,
        );
      }
    }
  } catch (err) {
    console.warn(`[strategy/notify] AI evaluation failed for ${strategy.id}:`, err);
  }

  // ── 9. Build Telegram message ──────────────────────────────────────────────
  const message = formatStrategySignalMessage({
    strategyName:    strategy.name,
    longName:        strategy.longName,
    rating,
    symbol:          strategy.symbol,
    timeframe:       strategy.timeframe,
    direction,
    entryPrice:      lastClosed.close,
    entryPriceLimit,
    stopLossPct:     strategy.risk.stopLossPct,
    takeProfitPct:   strategy.risk.takeProfitPct,
    conditionGroups,
    timestamp:       lastClosed.closeTime + 1,
    aiEvaluation,
  });

  return {
    fired: true,
    strategy,
    message,
    entryPrice: lastClosed.close,
    entryPriceLimit,
    rating,
    candleTime: lastClosed.openTime,
    conditionGroups,
    aiEvaluation,
    debug: fullDebug,
  };
}


// ─── Per-condition check ──────────────────────────────────────────────────────
// Delegates to the shared evaluateConditionChecked() in evaluate.ts so the
// notify path is guaranteed to match the backtester and chart markers exactly.

function conditionPassesCheck(
  condition: StrategyCondition,
  closed:    Candle[],
  cache:     Map<string, Map<number, number>>,
): boolean {
  return evaluateConditionChecked(condition, closed, closed.length - 1, cache);
}


/**
 * Atomically stamp the strategy's last_notified_trade_time.
 *
 * The WHERE guard ensures only the first writer wins when two cron processes
 * overlap — equivalent to a test-and-set.
 *
 * Returns true  → we won the race, safe to send the Telegram message.
 * Returns false → another process already stamped this candle, skip.
 */
async function tryStampNotifiedTime(strategyId: string, openTimeMs: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE strategies
     SET last_notified_trade_time = to_timestamp($2::bigint / 1000.0)
     WHERE id = $1
       AND (
         last_notified_trade_time IS NULL
         OR last_notified_trade_time < to_timestamp($2::bigint / 1000.0)
       )`,
    [strategyId, openTimeMs],
  );
  return (rowCount ?? 0) > 0;
}

export async function getNotifiableStrategies(): Promise<
  Array<{ strategy: Strategy; lastNotifiedTimeMs: number | null }>
> {
  const { rows } = await db.query<{
    definition:               Record<string, unknown>;
    last_notified_trade_time: Date | null;
  }>(
    `SELECT definition, last_notified_trade_time
     FROM strategies
     WHERE notify_on_signal = TRUE
       AND (definition->>'isActive')::boolean = true`,
  );
  return rows.map((r) => ({
    strategy:           r.definition as unknown as Strategy,
    lastNotifiedTimeMs: r.last_notified_trade_time
                          ? r.last_notified_trade_time.getTime()
                          : null,
  }));
}
