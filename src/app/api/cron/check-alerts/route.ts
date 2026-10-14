/**
 * POST /api/cron/check-alerts
 *
 * Runs every minute via Vercel cron (see vercel.json).
 * Handles two types of notifications:
 *
 *   1. Indicator alerts — standalone rules from the alert_rules table.
 *      Fires when a condition (RSI < 30, price > X, etc.) is met on the
 *      last closed candle, subject to per-rule cooldown.
 *
 *   2. Strategy signals — strategies with notifyOnSignal = true in DB.
 *      Fires when a new entry signal appears since last_notified_trade_time.
 *
 * Also exposed as GET for easy manual triggering in dev.
 */

import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';
import { getEnabledAlertRules, logAlertFired, markAlertDelivered } from '@/lib/db/alerts';
import { evaluateAlertRule } from '@/lib/alerts/evaluate';
import { getNotifiableStrategies, evaluateStrategySignal, runOrderEvaluationForSignal, type StrategyNotifyResult } from '@/lib/strategy/notify';
import { sendTelegramAlert, resolveStrategyTelegramTopic, formatStrategySignalMessage, formatMarketFlushMessage } from '@/lib/alerts/telegram';
import { logStrategySignal } from '@/lib/db/signals';
import { shouldRunAiVerdict } from '@/lib/strategy/rating';
import { evaluateMarketFlush, type FiredSignalSummary } from '@/lib/ai/evaluator/macro';

export const maxDuration = 60;

async function runCheckAlerts(): Promise<Response> {
  // Run both checks concurrently — they're independent.
  const [rules, notifiableStrategies] = await Promise.all([
    getEnabledAlertRules(),
    getNotifiableStrategies(),
  ]);

  let firedCount = 0;

  // ── 1. Indicator alerts ───────────────────────────────────────────────────
  const alertResults = await Promise.allSettled(
    rules.map((rule) => evaluateAlertRule(rule)),
  );

  for (const result of alertResults) {
    if (result.status === 'rejected') {
      console.error('[cron:check-alerts] evaluateAlertRule threw:', result.reason);
      continue;
    }

    const evalResult = result.value;
    if (!evalResult.fired) continue;

    firedCount++;
    console.log(`[cron:check-alerts] INDICATOR FIRED: ${evalResult.rule.name} (${evalResult.rule.symbol})`);

    let historyEntry: Awaited<ReturnType<typeof logAlertFired>> | null = null;
    try {
      historyEntry = await logAlertFired(evalResult.rule.id, evalResult.message);
    } catch (err) {
      console.error('[cron:check-alerts] Failed to log alert history:', err);
    }

    const telegramResult = await sendTelegramAlert(evalResult.message, evalResult.rule.name, 'alert');
    if (telegramResult.ok) {
      if (historyEntry) {
        await markAlertDelivered(historyEntry.id).catch((err) =>
          console.error('[cron:check-alerts] markAlertDelivered failed:', err),
        );
      }
    } else {
      console.error(`[cron:check-alerts] Telegram failed: ${telegramResult.error}`);
    }
  }

  // ── 2. Strategy signals ───────────────────────────────────────────────────
  // Evaluate conditions for all notifiable strategies without running AI first
  const strategyResults = await Promise.allSettled(
    notifiableStrategies.map(({ strategy, lastNotifiedTimeMs }) =>
      evaluateStrategySignal(strategy, lastNotifiedTimeMs, { skipAi: true }),
    ),
  );

  // Collect per-strategy debug info to surface in the Manual response.
  const strategyDebug: Array<{
    name: string; symbol: string; timeframe: string;
    result: string; telegram?: string; debug?: Record<string, unknown>;
  }> = [];

  const firedResults: Array<Extract<StrategyNotifyResult, { fired: true }>> = [];

  for (const result of strategyResults) {
    if (result.status === 'rejected') {
      console.error('[cron:check-alerts] evaluateStrategySignal threw:', result.reason);
      strategyDebug.push({ name: '?', symbol: '?', timeframe: '?', result: `error: ${String(result.reason)}` });
      continue;
    }

    const evalResult = result.value;

    if (!evalResult.fired) {
      const reason = evalResult.reason;
      console.log(`[cron:check-alerts] Strategy skip (${reason}): ${evalResult.strategy.name}`);
      strategyDebug.push({
        name:      evalResult.strategy.name,
        symbol:    evalResult.strategy.symbol,
        timeframe: evalResult.strategy.timeframe,
        result:    reason,
        debug:     evalResult.debug as Record<string, unknown> | undefined,
      });
      continue;
    }

    firedResults.push(evalResult);
  }

  firedCount += firedResults.length;

  // ── 3. Branch: Option E (Market Flush >= 3) vs Option A + C (Isolated < 3) ──
  const FLUSH_THRESHOLD = 3;

  if (firedResults.length >= FLUSH_THRESHOLD) {
    // ── Option E: Market Flush Consolidated Digest ───────────────────────────
    console.log(`[cron:check-alerts] MARKET FLUSH: ${firedResults.length} strategies fired simultaneously!`);

    const signalSummaries: FiredSignalSummary[] = firedResults.map((f) => ({
      strategyName: f.strategy.name,
      symbol: f.strategy.symbol,
      timeframe: f.strategy.timeframe,
      direction: f.strategy.action.type === 'enter_long' ? 'long' : 'short',
      entryPrice: f.entryPrice,
      rating: f.rating,
    }));

    // 1 single Macro AI call for the entire cluster
    const macroEvaluation = await evaluateMarketFlush(
      signalSummaries,
      firedResults[0]?.candleTime ?? Date.now(),
    );

    // 1 consolidated Telegram message
    const digestMessage = formatMarketFlushMessage({
      signals: signalSummaries,
      macroEvaluation,
      timestamp: firedResults[0]?.candleTime ?? Date.now(),
    });

    const telegramResult = await sendTelegramAlert(
      digestMessage,
      `Market Flush (${firedResults.length})`,
      'signal',
    );

    const telegramStatus = telegramResult.ok
      ? `Digest sent to ${telegramResult.delivered} chat(s)`
      : `failed: ${telegramResult.error}`;

    // Log all signals to DB with macro verdict snapshot
    for (const f of firedResults) {
      logStrategySignal({
        strategyId:          f.strategy.id,
        strategyName:        f.strategy.name,
        symbol:              f.strategy.symbol,
        timeframe:           f.strategy.timeframe,
        direction:           f.strategy.action.type === 'enter_long' ? 'long' : 'short',
        entryPrice:          f.entryPrice,
        stopLossPct:         f.strategy.risk.stopLossPct,
        takeProfitPct:       f.strategy.risk.takeProfitPct,
        candleTime:          f.candleTime,
        telegramDelivered:   telegramResult.ok,
        conditionsSnapshot:  f.conditionGroups,
        rating:              f.rating,
        entryPriceLimit:     f.entryPriceLimit,
      }).catch((err) => console.error('[cron:check-alerts] logStrategySignal failed:', err));

      strategyDebug.push({
        name:      f.strategy.name,
        symbol:    f.strategy.symbol,
        timeframe: f.strategy.timeframe,
        result:    'fired (market flush digest)',
        telegram:  telegramStatus,
        debug:     f.debug as Record<string, unknown> | undefined,
      });
    }
  } else if (firedResults.length > 0) {
    // ── Option A + C: Individual Signal Processing with Cycle Cap ────────────
    const MAX_AI_PER_CYCLE = 2;

    // Filter AI candidates (Option C: strategy.aiGatekeeperEnabled === true && rating >= 4)
    const aiCandidates = firedResults.filter(
      (f) => f.strategy.aiGatekeeperEnabled === true && shouldRunAiVerdict(f.rating),
    );

    // Sort descending by rating (highest stars get AI evaluation first)
    aiCandidates.sort((a, b) => b.rating - a.rating);
    const eligibleForAi = new Set(aiCandidates.slice(0, MAX_AI_PER_CYCLE).map((f) => f.strategy.id));

    for (const f of firedResults) {
      const direction = f.strategy.action.type === 'enter_long' ? 'long' : 'short';
      let aiEvaluation: import('@/lib/ai/evaluator/types').OrderEvaluationResult | undefined;
      let finalMessage = f.message;

      if (eligibleForAi.has(f.strategy.id)) {
        try {
          aiEvaluation = await runOrderEvaluationForSignal(
            f.strategy,
            direction,
            f.entryPriceLimit ?? f.entryPrice,
            f.candleTime,
            f.closedCandles || [],
          );

          if (aiEvaluation) {
            finalMessage = formatStrategySignalMessage({
              strategyName:    f.strategy.name,
              longName:        f.strategy.longName,
              rating:          f.rating,
              symbol:          f.strategy.symbol,
              timeframe:       f.strategy.timeframe,
              direction,
              entryPrice:      f.entryPrice,
              entryPriceLimit: f.entryPriceLimit,
              stopLossPct:     f.strategy.risk.stopLossPct,
              takeProfitPct:   f.strategy.risk.takeProfitPct,
              conditionGroups: f.conditionGroups,
              timestamp:       f.candleTime,
              aiEvaluation,
            });
          }
        } catch (aiErr) {
          console.warn(`[cron:check-alerts] AI evaluation failed for ${f.strategy.name}:`, aiErr);
        }
      }

      console.log(`[cron:check-alerts] STRATEGY FIRED: ${f.strategy.name} (${f.strategy.symbol})`);

      const resolvedTopic = resolveStrategyTelegramTopic(f.strategy.telegramTopic, f.strategy.symbol);
      const telegramResult = await sendTelegramAlert(
        finalMessage,
        f.strategy.name,
        'signal',
        resolvedTopic,
      );

      const telegramStatus = telegramResult.ok
        ? `sent to ${telegramResult.delivered} chat(s)`
        : `failed: ${telegramResult.error}`;

      if (!telegramResult.ok) {
        console.error(`[cron:check-alerts] Telegram failed: ${telegramResult.error}`);
      }

      // Log signal to DB
      logStrategySignal({
        strategyId:          f.strategy.id,
        strategyName:        f.strategy.name,
        symbol:              f.strategy.symbol,
        timeframe:           f.strategy.timeframe,
        direction,
        entryPrice:          f.entryPrice,
        stopLossPct:         f.strategy.risk.stopLossPct,
        takeProfitPct:       f.strategy.risk.takeProfitPct,
        candleTime:          f.candleTime,
        telegramDelivered:   telegramResult.ok,
        conditionsSnapshot:  f.conditionGroups,
        rating:              f.rating,
        entryPriceLimit:     f.entryPriceLimit,
        aiEvaluation,
      }).catch((err) => console.error('[cron:check-alerts] logStrategySignal failed:', err));

      strategyDebug.push({
        name:      f.strategy.name,
        symbol:    f.strategy.symbol,
        timeframe: f.strategy.timeframe,
        result:    'fired',
        telegram:  telegramStatus,
        debug:     f.debug as Record<string, unknown> | undefined,
      });
    }
  }

  return Response.json({
    ok:                 true,
    alertsEvaluated:   rules.length,
    strategiesChecked: notifiableStrategies.length,
    fired:             firedCount,
    // Per-strategy detail — visible in the Manual button response in dev tools
    strategies:        strategyDebug,
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    return await runCheckAlerts();
  } catch (err) {
    console.error('[cron:check-alerts] Unhandled error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();
  try {
    return await runCheckAlerts();
  } catch (err) {
    console.error('[cron:check-alerts] Unhandled error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
