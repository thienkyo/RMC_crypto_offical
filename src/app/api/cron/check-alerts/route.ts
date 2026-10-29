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
import { sendTelegramAlert, resolveStrategyTelegramTopic, formatStrategySignalMessage, formatMarketFlushMessage, isSignalChartEnabled, type TelegramAlertImage } from '@/lib/alerts/telegram';
import { generateSignalChartPng } from '@/lib/alerts/signalChart';
import { logStrategySignal, markSignalDelivered } from '@/lib/db/signals';
import { shouldRunAiVerdict } from '@/lib/strategy/rating';
import { evaluateMarketFlush, type FiredSignalSummary } from '@/lib/ai/evaluator/macro';
import { registerOrConfirmSignalMonitor, runSignalMonitorCheck } from '@/lib/alerts/signalMonitor';

export const maxDuration = 60;

export async function runCheckAlerts(): Promise<Response> {
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

  // ── 2b. Intra-cycle deduplication by symbol ───────────────────────────────
  // When multiple strategies fire on the same symbol in the same cron tick
  // (including opposing LONG and SHORT signals), keep only the single
  // highest-rated signal to prevent stacking or contradictory alerts.
  const bestBySymbol = new Map<string, Extract<StrategyNotifyResult, { fired: true }>>();
  for (const f of firedResults) {
    const key = f.strategy.symbol;
    const existing = bestBySymbol.get(key);
    if (!existing || f.rating > existing.rating) {
      if (existing) {
        strategyDebug.push({
          name:      existing.strategy.name,
          symbol:    existing.strategy.symbol,
          timeframe: existing.strategy.timeframe,
          result:    `dedup_same_symbol (superseded by ${f.strategy.name} ${f.rating}★)`,
          debug:     existing.debug as Record<string, unknown> | undefined,
        });
      }
      bestBySymbol.set(key, f);
    } else {
      strategyDebug.push({
        name:      f.strategy.name,
        symbol:    f.strategy.symbol,
        timeframe: f.strategy.timeframe,
        result:    `dedup_same_symbol (superseded by ${existing.strategy.name} ${existing.rating}★)`,
        debug:     f.debug as Record<string, unknown> | undefined,
      });
    }
  }

  const dedupedFiredResults = Array.from(bestBySymbol.values());
  firedCount += dedupedFiredResults.length;

  // ── 3. Branch: Option E (Market Flush >= 3) vs Option A + C (Isolated < 3) ──
  const FLUSH_THRESHOLD = 3;

  if (dedupedFiredResults.length >= FLUSH_THRESHOLD) {
    // ── Option E: Market Flush Consolidated Digest ───────────────────────────
    console.log(`[cron:check-alerts] MARKET FLUSH: ${dedupedFiredResults.length} strategies fired simultaneously!`);

    const signalSummaries: FiredSignalSummary[] = dedupedFiredResults.map((f) => ({
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
      dedupedFiredResults[0]?.candleTime ?? Date.now(),
    );

    // Log all signals to DB first so we can include their DB signalId in the Telegram digest
    const loggedSignalIds = new Map<string, number>();
    await Promise.all(
      dedupedFiredResults.map(async (f) => {
        try {
          const sigId = await logStrategySignal({
            strategyId:          f.strategy.id,
            strategyName:        f.strategy.name,
            symbol:              f.strategy.symbol,
            timeframe:           f.strategy.timeframe,
            direction:           f.strategy.action.type === 'enter_long' ? 'long' : 'short',
            entryPrice:          f.entryPrice,
            stopLossPct:         f.strategy.risk.stopLossPct,
            takeProfitPct:       f.strategy.risk.takeProfitPct,
            candleTime:          f.candleTime,
            telegramDelivered:   false,
            conditionsSnapshot:  f.conditionGroups,
            rating:              f.rating,
            entryPriceLimit:     f.entryPriceLimit,
          });
          loggedSignalIds.set(f.strategy.id, sigId);
        } catch (err) {
          console.error('[cron:check-alerts] logStrategySignal failed:', err);
        }
      }),
    );

    // 1 consolidated Telegram message (with signalId and strategyId per row)
    const digestMessage = formatMarketFlushMessage({
      signals: dedupedFiredResults.map((f) => ({
        strategyName: f.strategy.name,
        symbol:       f.strategy.symbol,
        timeframe:    f.strategy.timeframe,
        direction:    f.strategy.action.type === 'enter_long' ? 'long' : 'short',
        entryPrice:   f.entryPrice,
        rating:       f.rating,
        signalId:     loggedSignalIds.get(f.strategy.id),
        strategyId:   f.strategy.id,
      })),
      macroEvaluation,
      timestamp: dedupedFiredResults[0]?.candleTime ?? Date.now(),
    });

    const telegramResult = await sendTelegramAlert(
      digestMessage,
      `Market Flush (${dedupedFiredResults.length})`,
      'signal',
    );

    if (telegramResult.ok) {
      await Promise.all(
        Array.from(loggedSignalIds.values()).map((sigId) =>
          markSignalDelivered(sigId).catch((err) =>
            console.error('[cron:check-alerts] markSignalDelivered failed:', err),
          ),
        ),
      );
    }

    const telegramStatus = telegramResult.ok
      ? `Digest sent to ${telegramResult.delivered} chat(s)`
      : `failed: ${telegramResult.error}`;

    for (const f of dedupedFiredResults) {
      strategyDebug.push({
        name:      f.strategy.name,
        symbol:    f.strategy.symbol,
        timeframe: f.strategy.timeframe,
        result:    'fired (market flush digest)',
        telegram:  telegramStatus,
        debug:     f.debug as Record<string, unknown> | undefined,
      });
    }
  } else if (dedupedFiredResults.length > 0) {
    // ── Option A + C: Individual Signal Processing with Cycle Cap ────────────
    const MAX_AI_PER_CYCLE = 2;

    // Filter AI candidates (Option C: strategy.aiGatekeeperEnabled === true && rating >= threshold)
    const aiCandidates = dedupedFiredResults.filter(
      (f) => f.strategy.aiGatekeeperEnabled === true && shouldRunAiVerdict(f.rating, f.strategy.minSignalRating),
    );

    // Sort descending by rating (highest stars get AI evaluation first)
    aiCandidates.sort((a, b) => b.rating - a.rating);
    const eligibleForAi = new Set(aiCandidates.slice(0, MAX_AI_PER_CYCLE).map((f) => f.strategy.id));

    for (const f of dedupedFiredResults) {
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

          if (aiEvaluation?.status === 'REJECT') {
            console.log(`[cron:check-alerts] Strategy rejected by AI Gatekeeper: ${f.strategy.name} (${f.strategy.symbol})`);
            // Log rejected signal to DB with telegramDelivered = false so the user can verify in Signal History why it was blocked
            try {
              await logStrategySignal({
                strategyId:          f.strategy.id,
                strategyName:        f.strategy.name,
                symbol:              f.strategy.symbol,
                timeframe:           f.strategy.timeframe,
                direction,
                entryPrice:          f.entryPrice,
                stopLossPct:         f.strategy.risk.stopLossPct,
                takeProfitPct:       f.strategy.risk.takeProfitPct,
                candleTime:          f.candleTime,
                telegramDelivered:   false,
                conditionsSnapshot:  f.conditionGroups,
                rating:              f.rating,
                entryPriceLimit:     f.entryPriceLimit,
                aiEvaluation,
              });
            } catch (err) {
              console.error('[cron:check-alerts] logStrategySignal (rejected) failed:', err);
            }

            strategyDebug.push({
              name:      f.strategy.name,
              symbol:    f.strategy.symbol,
              timeframe: f.strategy.timeframe,
              result:    'rejected_by_ai',
              debug:     f.debug as Record<string, unknown> | undefined,
            });
            continue;
          }

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
              dynamicLevels:   f.dynamicLevels,
            });
          }
        } catch (aiErr) {
          console.warn(`[cron:check-alerts] AI evaluation failed for ${f.strategy.name}:`, aiErr);
        }
      }

      console.log(`[cron:check-alerts] STRATEGY FIRED: ${f.strategy.name} (${f.strategy.symbol})`);

      // Log signal to DB first so we can embed its DB row ID (sig#N) in the Telegram message
      let signalId: number | undefined;
      try {
        signalId = await logStrategySignal({
          strategyId:          f.strategy.id,
          strategyName:        f.strategy.name,
          symbol:              f.strategy.symbol,
          timeframe:           f.strategy.timeframe,
          direction,
          entryPrice:          f.entryPrice,
          stopLossPct:         f.strategy.risk.stopLossPct,
          takeProfitPct:       f.strategy.risk.takeProfitPct,
          candleTime:          f.candleTime,
          telegramDelivered:   false,
          conditionsSnapshot:  f.conditionGroups,
          rating:              f.rating,
          entryPriceLimit:     f.entryPriceLimit,
          aiEvaluation,
        });
      } catch (err) {
        console.error('[cron:check-alerts] logStrategySignal failed:', err);
      }

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
        signalId,
        strategyId:      f.strategy.id,
        strategyVersion: f.strategy.version,
        dynamicLevels:   f.dynamicLevels,
      });

      // Render chart image attachment if enabled (default: true)
      let alertImage: TelegramAlertImage | undefined;
      const chartEnabled = await isSignalChartEnabled();
      if (chartEnabled && f.closedCandles && f.closedCandles.length > 0) {
        try {
          const slPrice = f.strategy.risk.stopLossPct
            ? (direction === 'long'
                ? f.entryPrice * (1 - f.strategy.risk.stopLossPct / 100)
                : f.entryPrice * (1 + f.strategy.risk.stopLossPct / 100))
            : undefined;
          const tpPrice = f.strategy.risk.takeProfitPct
            ? (direction === 'long'
                ? f.entryPrice * (1 + f.strategy.risk.takeProfitPct / 100)
                : f.entryPrice * (1 - f.strategy.risk.takeProfitPct / 100))
            : undefined;

          const chartBuffer = await generateSignalChartPng({
            symbol:          f.strategy.symbol,
            timeframe:       f.strategy.timeframe,
            strategyName:    f.strategy.name,
            direction,
            rating:          f.rating,
            entryPrice:      f.entryPrice,
            entryPriceLimit: f.entryPriceLimit,
            stopLossPrice:   slPrice,
            takeProfitPrice: tpPrice,
            stopLossPct:     f.strategy.risk.stopLossPct,
            takeProfitPct:   f.strategy.risk.takeProfitPct,
            candles:         f.closedCandles,
            signalId,
            aiEvaluation,
            dynamicLevels:   f.dynamicLevels,
          });

          const dirBadge = direction === 'long' ? 'LONG ▲' : 'SHORT ▼';
          const aiTag = aiEvaluation ? ` • [${aiEvaluation.status === 'PASS' ? '🟢' : '🟡'} AI ${aiEvaluation.status}]` : '';
          const sigTag = signalId ? ` • sig#${signalId}` : '';
          alertImage = {
            buffer: chartBuffer,
            caption: `📊 <b>${f.strategy.symbol} (${f.strategy.timeframe.toUpperCase()})</b> • ${dirBadge}${aiTag}${sigTag}`,
          };
        } catch (chartErr) {
          console.warn(`[cron:check-alerts] Failed to generate signal chart for ${f.strategy.name}:`, chartErr);
        }
      }

      const resolvedTopic = resolveStrategyTelegramTopic(
        f.strategy.telegramTopic,
        f.strategy.symbol,
        f.strategy.isCommon,
        f.strategy.symbols,
      );
      const telegramResult = await sendTelegramAlert(
        finalMessage,
        f.strategy.name,
        'signal',
        resolvedTopic,
        alertImage,
      );

      if (telegramResult.ok) {
        if (signalId !== undefined) {
          await markSignalDelivered(signalId).catch((err) =>
            console.error('[cron:check-alerts] markSignalDelivered failed:', err),
          );
        }

        await registerOrConfirmSignalMonitor({
          signalId,
          strategyId:        f.strategy.id,
          strategyName:      f.strategy.name,
          symbol:            f.strategy.symbol,
          timeframe:         f.strategy.timeframe,
          direction,
          entryPrice:        f.entryPrice,
          stopLossPct:       f.strategy.risk?.stopLossPct,
          takeProfitPct:     f.strategy.risk?.takeProfitPct,
          dynamicLevels:     f.dynamicLevels,
          telegramMessageId: telegramResult.messageId,
          telegramTopic:     resolvedTopic,
        }).catch((mErr) =>
          console.warn('[cron:check-alerts] registerOrConfirmSignalMonitor failed:', mErr),
        );
      }

      const telegramStatus = telegramResult.ok
        ? `sent to ${telegramResult.delivered} chat(s)`
        : `failed: ${telegramResult.error}`;

      if (!telegramResult.ok) {
        console.error(`[cron:check-alerts] Telegram failed: ${telegramResult.error}`);
      }

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

  // ── Run post-signal monitor cycle ─────────────────────────────────────────
  const monitorStats = await runSignalMonitorCheck().catch((err) => {
    console.warn('[cron:check-alerts] runSignalMonitorCheck failed:', err);
    return null;
  });

  return Response.json({
    ok:                 true,
    alertsEvaluated:   rules.length,
    strategiesChecked: notifiableStrategies.length,
    fired:             firedCount,
    monitors:          monitorStats,
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
