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
import { getNotifiableStrategies, evaluateStrategySignal } from '@/lib/strategy/notify';
import { sendTelegramAlert } from '@/lib/alerts/telegram';

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

    const telegramResult = await sendTelegramAlert(evalResult.message, evalResult.rule.name);
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
  const strategyResults = await Promise.allSettled(
    notifiableStrategies.map(({ strategy, lastNotifiedTimeMs }) =>
      evaluateStrategySignal(strategy, lastNotifiedTimeMs),
    ),
  );

  // Collect per-strategy debug info to surface in the Manual response.
  const strategyDebug: Array<{
    name: string; symbol: string; timeframe: string;
    result: string; telegram?: string; debug?: Record<string, unknown>;
  }> = [];

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

    firedCount++;
    console.log(`[cron:check-alerts] STRATEGY FIRED: ${evalResult.strategy.name} (${evalResult.strategy.symbol})`);

    const telegramResult = await sendTelegramAlert(evalResult.message, evalResult.strategy.name);
    const telegramStatus = telegramResult.ok
      ? `sent to ${telegramResult.delivered} chat(s)`
      : `failed: ${telegramResult.error}`;

    if (!telegramResult.ok) {
      console.error(`[cron:check-alerts] Telegram failed: ${telegramResult.error}`);
    }

    strategyDebug.push({
      name:      evalResult.strategy.name,
      symbol:    evalResult.strategy.symbol,
      timeframe: evalResult.strategy.timeframe,
      result:    'fired',
      telegram:  telegramStatus,
      debug:     evalResult.debug as Record<string, unknown> | undefined,
    });
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
