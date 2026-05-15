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
import { fetchKlines, TF_TO_MS }      from '@/lib/exchange/binance';
import { buildIndicatorCache,
         conditionCacheKey,
         evaluateConditionChecked,
         evaluateConditionGroupsChecked } from '@/lib/strategy/evaluate';
import { formatStrategySignalMessage,
         strategyRating }              from '@/lib/alerts/telegram';
import { conditionLabel }              from '@/lib/alerts/evaluate';
import type { Strategy, StrategyCondition } from '@/types/strategy';
import type { Candle, Timeframe }      from '@/types/market';

const CANDLE_WINDOW = 1_000;

export type StrategyNotifyResult =
  | { fired: true;  strategy: Strategy; message: string; debug?: StrategyNotifyDebug }
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
  // ── 1. Fetch candles ───────────────────────────────────────────────────────
  let candles: Candle[];
  try {
    candles = await fetchLatestCandles(strategy.symbol, strategy.timeframe, CANDLE_WINDOW);
  } catch (err) {
    console.error(`[strategy/notify] DB fetch failed for ${strategy.id}:`, err);
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

  // ── 7. Build message ───────────────────────────────────────────────────────
  const activeConditions = strategy.entryConditions
    .flatMap((g) => g.conditions)
    .filter((c) => c.enabled !== false);

  // Calculate extra confirmation score: only 'confirmation' mode increases difficulty.
  const extraConfirmations = activeConditions.reduce((sum, c) => {
    const mode = c.checkMode ?? 'confirmation';
    if (mode === 'confirmation') {
      return sum + Math.max(0, (c.checkCandles ?? 1) - 1);
    }
    return sum;
  }, 0);

  // Map to structured display format for Telegram
  const conditionGroups = strategy.entryConditions
    .filter((g) => g.conditions.some((c) => c.enabled !== false))
    .map((g) => ({
      groupOperator:     g.operator ?? 'or',
      conditionOperator: g.conditionOperator ?? (g.operator === 'and' ? 'or' : 'and'),
      label:             g.label,
      conditions:        g.conditions
        .filter((c) => c.enabled !== false)
        .map((c) => {
          const key = conditionCacheKey(c);
          const timeMap = cache.get(key);
          const value = timeMap?.get(lastClosed.openTime);
          return {
            label:  conditionLabel(c),
            passed: conditionPassesCheck(c, closed, cache),
            value,
          };
        }),
    }));

  const message = formatStrategySignalMessage({
    strategyName:  strategy.name,
    longName:      strategy.longName,
    rating:        strategyRating(activeConditions.length, extraConfirmations),
    symbol:        strategy.symbol,
    timeframe:     strategy.timeframe,
    direction:     strategy.action.type === 'enter_long' ? 'long' : 'short',
    entryPrice:    lastClosed.close,
    stopLossPct:   strategy.risk.stopLossPct,
    takeProfitPct: strategy.risk.takeProfitPct,
    conditionGroups,
    timestamp:     lastClosed.closeTime + 1,
  });

  return { fired: true, strategy, message, debug: fullDebug };
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

// ─── Candle fetching — always fresh tail ─────────────────────────────────────

/**
 * Fetch candles for signal evaluation.
 *
 * Root cause of missed signals: the cron reads the DB directly, but the DB is
 * only updated when /api/candles is requested (i.e. when someone has the chart
 * open). A just-closed candle may sit in Binance for several minutes before it
 * appears in the DB. With the old "stale after 3 periods" guard, the cron could
 * silently evaluate a 1–2 candle-old dataset and miss the new signal.
 *
 * Fix: ALWAYS fetch the last 5 candles from Binance REST (a trivial API call)
 * and merge them into the tail of the DB history. The DB provides the full
 * indicator warm-up window (1 000 bars); Binance provides guaranteed freshness.
 *
 * Merge rule: drop any DB candles whose openTime >= the earliest Binance
 * candle's openTime, then append the Binance batch. This handles both
 * "Binance has a newer candle" and "Binance has corrected the forming bar".
 */
async function fetchLatestCandles(
  symbol:    string,
  timeframe: string,
  limit:     number,
): Promise<Candle[]> {
  // ── 1. DB fetch (history / warm-up window) ───────────────────────────────
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

  const dbCandles: Candle[] = rows.reverse().map((r) => ({
    openTime:  r.open_time.getTime(),
    open:      parseFloat(r.open),
    high:      parseFloat(r.high),
    low:       parseFloat(r.low),
    close:     parseFloat(r.close),
    volume:    parseFloat(r.volume),
    closeTime: r.close_time.getTime(),
  }));

  // ── 2. Always fetch a fresh tail from Binance ────────────────────────────
  // Calculate how many candles are missing between the DB tail and now.
  // This guarantees we bridge the gap if the DB hasn't been updated recently,
  // preventing corrupted indicator calculations due to missing candles.
  try {
    const dbTailTime = dbCandles.length > 0 ? dbCandles[dbCandles.length - 1]!.openTime : 0;
    const tfMs = TF_TO_MS[timeframe as Timeframe];
    // We add 5 as a safety buffer
    const missingCandles = dbTailTime > 0 ? Math.ceil((Date.now() - dbTailTime) / tfMs) + 5 : limit;
    const fetchLimit = Math.min(limit, Math.max(5, missingCandles));

    const freshTail = await fetchKlines(
      symbol,
      timeframe as Timeframe,
      fetchLimit,
      undefined,
      true, // noCache — bypass any in-memory cache
    );

    if (freshTail.length === 0) return dbCandles;

    // Merge: keep DB history up to (but not including) the first fresh bar,
    // then append the fresh tail.  This replaces both the forming bar and any
    // candles that closed since the DB was last updated.
    const freshStart = freshTail[0]!.openTime;
    const base = dbCandles.filter((c) => c.openTime < freshStart);
    const merged = [...base, ...freshTail];

    console.log(
      `[strategy/notify] ${symbol}/${timeframe}: ` +
      `DB tail=${new Date(dbCandles[dbCandles.length - 1]?.openTime ?? 0).toISOString()}, ` +
      `Binance tail=${new Date(freshTail[freshTail.length - 1]!.openTime).toISOString()}, ` +
      `merged=${merged.length} candles`,
    );

    return merged;
  } catch (err) {
    // Non-fatal — fall back to DB-only data.
    console.warn(`[strategy/notify] Binance tail fetch failed for ${symbol}/${timeframe}:`, err);
    return dbCandles;
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
