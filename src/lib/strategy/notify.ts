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
import { TF_TO_MS }                    from '@/lib/exchange/binance';
import { buildIndicatorCache,
         conditionCacheKey,
         evaluateConditionChecked,
         evaluateConditionGroupsChecked } from '@/lib/strategy/evaluate';
import { collectHtfTimeframes, buildMtfIndicatorCache, type HtfCandleSets } from '@/lib/strategy/mtf';
import { formatStrategySignalMessage }  from '@/lib/alerts/telegram';
import { signalScore, shouldRunAiVerdict } from '@/lib/strategy/rating';
import { conditionLabel }              from '@/lib/alerts/evaluate';
import { computeEntryPriceLimit }      from '@/lib/strategy/entryPrice';
import { isEquitySymbol }              from '@/lib/exchange/equities';
import { getUSEquityMarketStatus }     from '@/lib/exchange/marketHours';
import type { Strategy, StrategyCondition } from '@/types/strategy';
import type { Candle, Timeframe }      from '@/types/market';
import type { ConditionSnapshotGroup } from '@/lib/db/signals';

const CANDLE_WINDOW = 1_000;
/** Default minimum star rating required to fire a live signal (3 = Grade C+). */
export const DEFAULT_MIN_SIGNAL_RATING = 3;
/** Number of bars to block duplicate signals on the same symbol + direction. */
const SYMBOL_COOLDOWN_BARS = 2;

export type StrategyNotifySkipReason =
  | 'first_run'
  | 'dedup_blocked'
  | 'conditions_not_met'
  | 'low_rating'
  | 'symbol_cooldown'
  | 'ai_rejected'
  | 'no_candles'
  | 'error'
  | 'market_closed';

export type StrategyNotifyResult =
  | { fired: true;  strategy: Strategy; message: string; entryPrice: number; entryPriceLimit: number; rating: number; candleTime: number; conditionGroups: ConditionSnapshotGroup[]; aiEvaluation?: import('@/lib/ai/evaluator/types').OrderEvaluationResult; closedCandles?: Candle[]; debug?: StrategyNotifyDebug }
  | { fired: false; strategy: Strategy; reason: StrategyNotifySkipReason; debug?: StrategyNotifyDebug };


/** Debug context surfaced in the cron Manual response. */
export interface StrategyNotifyDebug {
  lastClosedOpenTime: string;    // ISO — the candle we evaluated
  lastNotifiedTimeMs: string;    // ISO — what was stamped in DB (or 'null')
  candleCount: number;
  rating?: number;
  minRating?: number;
  conditionResults?: Array<{ label: string; passed: boolean }>;
}

export async function evaluateStrategySignal(
  strategy: Strategy,
  lastNotifiedTimeMs: number | null,
  opts?: { skipAi?: boolean },
): Promise<StrategyNotifyResult> {
  // ── 0. Market session gate for equities ───────────────────────────────────
  if (isEquitySymbol(strategy.symbol)) {
    const marketStatus = getUSEquityMarketStatus();
    if (!marketStatus.isOpen) {
      return { fired: false, strategy, reason: 'market_closed' };
    }
  }

  // ── 1. Fetch candles (cached & deduplicated) ──────────────────────────────
  let candles: Candle[];
  try {
    candles = await fetchLatestCandlesCached(strategy.symbol, strategy.timeframe, CANDLE_WINDOW);
  } catch (err) {
    console.error(`[strategy/notify] Cached fetch failed for ${strategy.id}:`, err);
    return { fired: false, strategy, reason: 'error' };
  }

  // Evaluate up to and including the current live (forming) candle so signals
  // fire intra-bar on the 5m/10m/15m check interval instead of waiting up to 4h
  // for the bar to close. Dedup is still stamped by the bar's openTime so a
  // strategy fires at most once per timeframe bar.
  const evalCandles = candles;
  if (evalCandles.length < 2) return { fired: false, strategy, reason: 'no_candles' };

  const targetBar = evalCandles[evalCandles.length - 1]!;

  const baseDebug = {
    lastClosedOpenTime: new Date(targetBar.openTime).toISOString(),
    lastNotifiedTimeMs: lastNotifiedTimeMs !== null
      ? new Date(lastNotifiedTimeMs).toISOString()
      : 'null',
    candleCount: evalCandles.length,
  };

  // ── 2. First-run guard ─────────────────────────────────────────────────────
  if (lastNotifiedTimeMs === null) {
    await tryStampNotifiedTime(strategy.id, targetBar.openTime);
    return { fired: false, strategy, reason: 'first_run', debug: baseDebug };
  }

  // ── 3. Dedup gate — same candle period already notified ───────────────────
  if (targetBar.openTime <= lastNotifiedTimeMs) {
    return { fired: false, strategy, reason: 'dedup_blocked', debug: baseDebug };
  }

  // ── 4. Fetch HTF candles & Build indicator cache ───────────────────────────
  let cache: Map<string, Map<number, number>>;
  try {
    const htfTfs = collectHtfTimeframes(strategy);
    const htfCandles: HtfCandleSets = {};
    if (htfTfs.length > 0) {
      const htfPromises = htfTfs.map((tf) => fetchLatestCandlesCached(strategy.symbol, tf, CANDLE_WINDOW));
      const htfResults = await Promise.all(htfPromises);
      htfTfs.forEach((tf, i) => {
        htfCandles[tf] = htfResults[i]!;
      });
    }

    const allConditions = strategy.entryConditions.flatMap((g) => g.conditions);
    cache = htfTfs.length > 0 
      ? buildMtfIndicatorCache(strategy, evalCandles, htfCandles)
      : buildIndicatorCache(allConditions, evalCandles);
  } catch (err) {
    console.error(`[strategy/notify] buildIndicatorCache failed for ${strategy.id}:`, err);
    return { fired: false, strategy, reason: 'error', debug: baseDebug };
  }

  // ── 5. Evaluate condition groups ───────────────────────────────────────────
  // Use the canonical evaluation functions to ensure notify logic matches
  // backtester and chart markers. Honour regime-aware gating for pure level groups.
  const direction = strategy.action.type === 'enter_long' ? 'long' : 'short';
  const fired = evaluateConditionGroupsChecked(
    strategy.entryConditions,
    evalCandles,
    evalCandles.length - 1,
    cache,
    direction,
  );

  // Collect per-condition pass/fail for debug output (only for enabled conditions).
  const conditionResults = strategy.entryConditions
    .flatMap((g) => g.conditions)
    .filter((c) => c.enabled !== false)
    .map((c) => ({
      label:  conditionLabel(c),
      passed: conditionPassesCheck(c, evalCandles, cache),
    }));

  const fullDebug = { ...baseDebug, conditionResults };

  if (!fired) return { fired: false, strategy, reason: 'conditions_not_met', debug: fullDebug };

  // ── 6. Build condition snapshot & compute rating ───────────────────────────
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
          const value   = timeMap?.get(targetBar.openTime);
          return {
            label:        conditionLabel(c),
            passed:       conditionPassesCheck(c, evalCandles, cache),
            value,
            checkCandles: c.checkCandles ?? 1,
            checkMode:    c.checkMode    ?? 'confirmation',
          };
        }),
    }));

  const rating    = signalScore(conditionGroups);
  const minRating = strategy.minSignalRating ?? DEFAULT_MIN_SIGNAL_RATING;
  const ratedDebug: StrategyNotifyDebug = { ...fullDebug, rating, minRating };

  // ── 6b. Minimum Signal Rating Gate ─────────────────────────────────────────
  if (rating < minRating) {
    console.log(
      `[strategy/notify] skip (low_rating): ${strategy.name} scored ${rating}★ < min ${minRating}★`,
    );
    return { fired: false, strategy, reason: 'low_rating', debug: ratedDebug };
  }

  // ── 6c. Per-Symbol Cooldown Gate ───────────────────────────────────────────
  const onSymbolCooldown = await hasRecentSymbolSignal(
    strategy.symbol,
    direction,
    targetBar.openTime,
    strategy.timeframe,
  );
  if (onSymbolCooldown) {
    console.log(
      `[strategy/notify] skip (symbol_cooldown): ${strategy.name} (${strategy.symbol} ${direction}) already signaled recently`,
    );
    return { fired: false, strategy, reason: 'symbol_cooldown', debug: ratedDebug };
  }

  // ── 7. Atomic stamp — race-condition guard ────────────────────────────────
  // Stamp BEFORE building/sending the message. The UPDATE only succeeds if no
  // other cron process has already stamped this candle (conditional WHERE).
  // If rowCount === 0, we lost the race — bail out silently.
  const stamped = await tryStampNotifiedTime(strategy.id, targetBar.openTime);
  if (!stamped) {
    console.log(
      `[strategy/notify] dedup (concurrent): ${strategy.name} already stamped for ` +
      new Date(targetBar.openTime).toISOString(),
    );
    return { fired: false, strategy, reason: 'dedup_blocked', debug: ratedDebug };
  }

  // ── 8. Compute limit entry price ──────────────────────────────────────────
  const entryPriceLimit = parseFloat(
    computeEntryPriceLimit(targetBar.close, strategy.action.entryPriceOffset, direction).toFixed(8),
  );

  // ── 8b. Optional AI Order Evaluation ───────────────────────────────────────
  // Option C: Strategy must explicitly enable AI Gatekeeper, not skipped by batch runner, and rating >= 4
  let aiEvaluation: import('@/lib/ai/evaluator/types').OrderEvaluationResult | undefined;
  const isAiEligible = !opts?.skipAi && strategy.aiGatekeeperEnabled === true && shouldRunAiVerdict(rating);
  if (isAiEligible) {
    aiEvaluation = await runOrderEvaluationForSignal(
      strategy,
      direction,
      entryPriceLimit ?? targetBar.close,
      targetBar.openTime,
      evalCandles,
    );
    if (aiEvaluation?.status === 'REJECT') {
      console.log(
        `[strategy/notify] skip (ai_rejected): ${strategy.name} rejected by AI Gatekeeper`,
      );
      return { fired: false, strategy, reason: 'ai_rejected', debug: ratedDebug };
    }
  }

  // ── 9. Build Telegram message ──────────────────────────────────────────────
  const message = formatStrategySignalMessage({
    strategyName:    strategy.name,
    longName:        strategy.longName,
    rating,
    symbol:          strategy.symbol,
    timeframe:       strategy.timeframe,
    direction,
    entryPrice:      targetBar.close,
    entryPriceLimit,
    stopLossPct:     strategy.risk.stopLossPct,
    takeProfitPct:   strategy.risk.takeProfitPct,
    conditionGroups,
    timestamp:       targetBar.openTime,
    aiEvaluation,
    strategyId:      strategy.id,
    strategyVersion: strategy.version,
  });

  return {
    fired: true,
    strategy,
    message,
    entryPrice: targetBar.close,
    entryPriceLimit,
    rating,
    candleTime: targetBar.openTime,
    conditionGroups,
    aiEvaluation,
    closedCandles: evalCandles,
    debug: ratedDebug,
  };
}

/**
 * Evaluates a single signal using the multi-LLM gatekeeper.
 */
export async function runOrderEvaluationForSignal(
  strategy: Strategy,
  direction: 'long' | 'short',
  entryPrice: number,
  candleTime: number,
  closedCandles: Candle[],
): Promise<import('@/lib/ai/evaluator/types').OrderEvaluationResult | undefined> {
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
        return await evaluateOrder(
          {
            symbol: strategy.symbol,
            timeframe: strategy.timeframe,
            direction,
            entryPrice,
            stopLossPct: strategy.risk.stopLossPct,
            takeProfitPct: strategy.risk.takeProfitPct,
            candleTime,
          },
          closedCandles,
        );
      }
    }
  } catch (err) {
    console.warn(`[strategy/notify] AI evaluation failed for ${strategy.id}:`, err);
  }
  return undefined;
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
 * Checks whether any strategy already logged a signal on the same symbol
 * (same direction within SYMBOL_COOLDOWN_BARS, or opposing direction on the
 * exact same candle) to prevent duplicate or contradictory Long/Short alerts.
 */
async function hasRecentSymbolSignal(
  symbol: string,
  direction: 'long' | 'short',
  candleTimeMs: number,
  timeframe: Timeframe,
): Promise<boolean> {
  try {
    const barMs = TF_TO_MS[timeframe] ?? 3600_000;
    const minCandleTimeMs = candleTimeMs - SYMBOL_COOLDOWN_BARS * barMs;
    const { rowCount } = await db.query(
      `SELECT 1
       FROM strategy_signals
       WHERE symbol = $1
         AND (
           (direction = $2 AND candle_time > to_timestamp($3::bigint / 1000.0))
           OR candle_time = to_timestamp($4::bigint / 1000.0)
         )
       LIMIT 1`,
      [symbol, direction, minCandleTimeMs, candleTimeMs],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    console.warn(`[strategy/notify] hasRecentSymbolSignal check failed for ${symbol}:`, err);
    return false;
  }
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
