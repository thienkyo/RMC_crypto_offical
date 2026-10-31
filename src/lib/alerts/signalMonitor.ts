/**
 * Post-Signal Monitoring Engine.
 *
 * Lifecycle:
 *  1. Signal fires → registerOrConfirmSignalMonitor creates or confirms monitor.
 *  2. Confluence: Same symbol + same direction → confirms existing trade thread without duplicating.
 *  3. Directional conflict: Same symbol + opposing direction → alerts active thread of opposing pressure.
 *  4. Continuous check:
 *     - Price Guardian (Take Profit / Stop Loss hit) → closes and reports to thread.
 *     - Breakeven Milestone (+1R or 50% to TP) → moves SL to entry and notifies thread.
 *     - Tiered Heartbeat → periodic progress updates at 15m, 30m, 60m, then every 4h up to 48h.
 */

import { db } from '@/lib/db/client';
import { sendTelegramAlert } from '@/lib/alerts/telegram';
import { fetchTickerPrices } from '@/lib/exchange/binance';
import { formatChartPrice } from '@/lib/format';
import type { DynamicAtrLevels } from '@/types/strategy';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Tiered follow-up schedule from signal creation:
 *  - 15m, 30m, 60m
 *  - Then every 4h up to 48h (4h, 8h, 12h, 16h, 20h, 24h, 28h, 32h, 36h, 40h, 44h, 48h)
 */
export const HEARTBEAT_MILESTONES_MS: readonly number[] = [
  15 * MIN_MS,
  30 * MIN_MS,
  60 * MIN_MS,
  4 * HOUR_MS,
  8 * HOUR_MS,
  12 * HOUR_MS,
  16 * HOUR_MS,
  20 * HOUR_MS,
  24 * HOUR_MS,
  28 * HOUR_MS,
  32 * HOUR_MS,
  36 * HOUR_MS,
  40 * HOUR_MS,
  44 * HOUR_MS,
  48 * HOUR_MS,
];

export const MAX_MONITOR_DURATION_MS = 48 * HOUR_MS;

/**
 * Returns the next heartbeat milestone offset (ms since created_at) that has not yet been sent,
 * or null if all milestones up to 48h have already been covered.
 * When `currentDurationMs` is passed, advances to the latest reached milestone if multiple
 * milestones elapsed while the server was paused.
 */
export function getNextHeartbeatMilestoneMs(
  lastHeartbeatOffsetMs: number,
  currentDurationMs?: number,
): number | null {
  let next: number | null = null;
  for (const milestone of HEARTBEAT_MILESTONES_MS) {
    if (milestone > lastHeartbeatOffsetMs) {
      if (next === null) {
        next = milestone;
      } else if (currentDurationMs !== undefined && currentDurationMs >= milestone) {
        next = milestone;
      } else {
        break;
      }
    }
  }
  return next;
}

export interface SignalMonitorRow {
  id: number;
  signal_id: number | null;
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entry_price: string;
  stop_loss_price: string;
  take_profit_price: string;
  breakeven_price: string;
  is_breakeven_armed: boolean;
  status: 'open' | 'closed';
  exit_reason: string | null;
  exit_price: string | null;
  exit_time: Date | null;
  max_price: string;
  min_price: string;
  max_profit_pct: string;
  max_drawdown_pct: string;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  telegram_thread_id: string | null;
  confluence_count: number;
  last_heartbeat_at: Date | null;
  last_checked_at: Date;
  created_at: Date;
}

export interface RegisterSignalMonitorParams {
  signalId?: number;
  strategyId: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  dynamicLevels?: DynamicAtrLevels;
  telegramChatId?: string;
  telegramMessageId?: number;
  telegramTopic?: { enabled: boolean; name: string };
}

export interface RegisterSignalMonitorResult {
  action: 'created' | 'confirmed' | 'error';
  monitorId?: number;
  confluenceCount?: number;
  error?: string;
}

export function formatTradeDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Register a newly fired signal into active monitoring, or confirm an existing
 * active trade if one already exists for this symbol and direction.
 */
export async function registerOrConfirmSignalMonitor(
  params: RegisterSignalMonitorParams,
): Promise<RegisterSignalMonitorResult> {
  const {
    signalId,
    strategyId,
    strategyName,
    symbol,
    timeframe,
    direction,
    entryPrice,
    stopLossPct = 2,
    takeProfitPct = 4,
    dynamicLevels,
    telegramChatId,
    telegramMessageId,
    telegramTopic,
  } = params;

  try {
    // ── 1. Check for active opposing signal (Directional Conflict Alert) ──
    const opposingDir = direction === 'long' ? 'short' : 'long';
    const { rows: opposingRows } = await db.query<SignalMonitorRow>(
      `SELECT * FROM signal_monitors
       WHERE symbol = $1 AND direction = $2 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [symbol, opposingDir],
    );

    if (opposingRows.length > 0) {
      const opposing = opposingRows[0]!;
      const oppMsgIdStr = opposing.telegram_message_id;
      if (oppMsgIdStr) {
        const oppMsgId = parseInt(oppMsgIdStr, 10);
        const oppTopic = opposing.telegram_thread_id
          ? { enabled: true, name: opposing.telegram_thread_id }
          : telegramTopic;
        const conflictMsg =
          `⚠️ <b>Directional Conflict Warning</b>\n` +
          `An opposing <b>${direction.toUpperCase()}</b> setup just fired on <b>${symbol}</b> (${timeframe.toUpperCase()} • ${strategyName}).\n` +
          `• Active position: <b>${opposing.direction.toUpperCase()}</b> from $${formatChartPrice(parseFloat(opposing.entry_price))}\n` +
          `• Suggestion: Consider tightening your Stop Loss or locking partial profits.`;

        sendTelegramAlert(
          conflictMsg,
          strategyName,
          'signal',
          oppTopic,
          undefined,
          oppMsgId,
        ).catch((err) => console.warn('[signal-monitor] Failed to send conflict alert:', err));
      }
    }

    // ── 2. Check for active same-direction signal (Confluence rule) ────────
    const { rows: activeRows } = await db.query<SignalMonitorRow>(
      `SELECT * FROM signal_monitors
       WHERE symbol = $1 AND direction = $2 AND status = 'open'
       ORDER BY created_at ASC LIMIT 1`,
      [symbol, direction],
    );

    if (activeRows.length > 0) {
      const active = activeRows[0]!;
      const newCount = (active.confluence_count ?? 1) + 1;

      await db.query(
        `UPDATE signal_monitors
         SET confluence_count = $1, last_checked_at = NOW()
         WHERE id = $2`,
        [newCount, active.id],
      );

      // Threaded confirmation reply under the original trade message
      if (active.telegram_message_id) {
        const rootMsgId = parseInt(active.telegram_message_id, 10);
        const activeTopic = active.telegram_thread_id
          ? { enabled: true, name: active.telegram_thread_id }
          : telegramTopic;
        const confluenceMsg =
          `🔗 <b>Signal Confluence Boost (#${newCount})</b>\n` +
          `• <b>Setup:</b> ${timeframe.toUpperCase()} <code>${strategyName}</code> confirmed this ${direction.toUpperCase()}.\n` +
          `• <b>Original Entry:</b> $${formatChartPrice(parseFloat(active.entry_price))}\n` +
          `• <b>Current Trigger:</b> $${formatChartPrice(entryPrice)}\n` +
          `• <i>Tracking as single unified trade thread.</i>`;

        sendTelegramAlert(
          confluenceMsg,
          strategyName,
          'signal',
          activeTopic,
          undefined,
          rootMsgId,
        ).catch((err) => console.warn('[signal-monitor] Failed to send confluence alert:', err));
      }

      return { action: 'confirmed', monitorId: active.id, confluenceCount: newCount };
    }

    // ── 3. Create fresh active monitor ────────────────────────────────────
    const slPct = stopLossPct > 0 ? stopLossPct : 2;
    const tpPct = takeProfitPct > 0 ? takeProfitPct : 4;

    let slPrice = dynamicLevels?.stopLossPrice
      ? dynamicLevels.stopLossPrice
      : direction === 'long'
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100);

    let tpPrice = dynamicLevels?.takeProfitPrice
      ? dynamicLevels.takeProfitPrice
      : direction === 'long'
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100);

    const breakevenPrice = entryPrice;
    const topicName = telegramTopic?.enabled && telegramTopic.name.trim()
      ? telegramTopic.name.trim()
      : null;

    const { rows: insertRows } = await db.query<{ id: number }>(
      `INSERT INTO signal_monitors (
         signal_id, strategy_id, strategy_name, symbol, timeframe, direction,
         entry_price, stop_loss_price, take_profit_price, breakeven_price,
         is_breakeven_armed, status, max_price, min_price,
         telegram_chat_id, telegram_message_id, telegram_thread_id, confluence_count,
         last_heartbeat_at, last_checked_at, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         FALSE, 'open', $7, $7,
         $11, $12, $13, 1,
         NOW(), NOW(), NOW()
       ) RETURNING id`,
      [
        signalId ?? null,
        strategyId,
        strategyName,
        symbol,
        timeframe,
        direction,
        entryPrice,
        slPrice,
        tpPrice,
        breakevenPrice,
        telegramChatId ?? null,
        telegramMessageId ?? null,
        topicName,
      ],
    );

    const newId = insertRows[0]?.id;
    return { action: 'created', monitorId: newId, confluenceCount: 1 };
  } catch (err) {
    console.error('[signal-monitor] registerOrConfirmSignalMonitor error:', err);
    return { action: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MonitorCheckResult {
  checked: number;
  closed: number;
  breakevenArmed: number;
  heartbeatsSent: number;
}

/**
 * Evaluates all currently active signal monitors against latest market prices.
 * Can accept a pre-fetched price map (symbol -> price) or queries latest candle closes.
 */
export async function runSignalMonitorCheck(
  priceMap?: Record<string, number>,
): Promise<MonitorCheckResult> {
  const result: MonitorCheckResult = {
    checked: 0,
    closed: 0,
    breakevenArmed: 0,
    heartbeatsSent: 0,
  };

  try {
    const { rows: monitors } = await db.query<SignalMonitorRow>(
      `SELECT * FROM signal_monitors
       WHERE status = 'open'
       ORDER BY created_at ASC`,
    );

    if (monitors.length === 0) return result;
    result.checked = monitors.length;

    // Build latest prices for symbols if not provided
    const prices: Record<string, number> = { ...(priceMap ?? {}) };
    const missingSymbols = Array.from(new Set(monitors.map((m) => m.symbol))).filter(
      (s) => prices[s] === undefined,
    );

    if (missingSymbols.length > 0) {
      // 1. Fetch live spot prices directly from Binance REST for crypto symbols
      const liveTickerPrices = await fetchTickerPrices(missingSymbols);
      for (const [sym, price] of Object.entries(liveTickerPrices)) {
        prices[sym] = price;
      }

      // 2. Fall back to DB candles for any remaining symbols (e.g. equities or if Binance unreachable)
      const stillMissing = missingSymbols.filter((s) => prices[s] === undefined);
      if (stillMissing.length > 0) {
        try {
          const { rows: candleRows } = await db.query<{ symbol: string; close: string }>(
            `SELECT DISTINCT ON (symbol) symbol, close
             FROM candles
             WHERE symbol = ANY($1)
             ORDER BY symbol, open_time DESC`,
            [stillMissing],
          );
          for (const r of candleRows) {
            prices[r.symbol] = parseFloat(r.close);
          }
        } catch (cErr) {
          console.warn('[signal-monitor] Failed to fetch latest candle prices from DB:', cErr);
        }
      }
    }

    const now = Date.now();

    for (const m of monitors) {
      const curPrice = prices[m.symbol];
      if (curPrice === undefined || isNaN(curPrice) || curPrice <= 0) continue;

      const entryPrice = parseFloat(m.entry_price);
      const slPrice = parseFloat(m.stop_loss_price);
      const tpPrice = parseFloat(m.take_profit_price);
      let maxPrice = Math.max(parseFloat(m.max_price), curPrice);
      let minPrice = Math.min(parseFloat(m.min_price), curPrice);

      const isLong = m.direction === 'long';
      const pnlPct = isLong
        ? ((curPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - curPrice) / entryPrice) * 100;

      let maxProfitPct = Math.max(parseFloat(m.max_profit_pct), pnlPct);
      let maxDrawdownPct = Math.min(parseFloat(m.max_drawdown_pct), pnlPct);

      const rootMsgId = m.telegram_message_id ? parseInt(m.telegram_message_id, 10) : undefined;
      const monitorTopic = m.telegram_thread_id
        ? { enabled: true, name: m.telegram_thread_id }
        : undefined;
      const durationMs = now - new Date(m.created_at).getTime();
      const durationStr = formatTradeDuration(durationMs);

      // ── 1. Check Take Profit ─────────────────────────────────────────────
      const isTakeProfitHit = isLong ? curPrice >= tpPrice : curPrice <= tpPrice;
      if (isTakeProfitHit) {
        await db.query(
          `UPDATE signal_monitors
           SET status = 'closed', exit_reason = 'take_profit', exit_price = $1, exit_time = NOW(),
               max_price = $2, min_price = $3, max_profit_pct = $4, max_drawdown_pct = $5,
               last_checked_at = NOW()
           WHERE id = $6`,
          [curPrice, maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
        );

        if (m.signal_id) {
          await db.query(
            `UPDATE strategy_signals
             SET actual_exit_price = $1, pnl_pct = $2, outcome_note = 'Take Profit hit via monitor', outcome_at = NOW()
             WHERE id = $3`,
            [curPrice, pnlPct, m.signal_id],
          ).catch((err) => console.warn('[signal-monitor] Failed to update strategy_signals exit:', err));
        }

        if (rootMsgId) {
          const tpMsg =
            `🎯 <b>Target Reached! (Take Profit)</b>\n` +
            `• <b>Symbol:</b> ${m.symbol} (${m.timeframe.toUpperCase()} • ${m.direction.toUpperCase()})\n` +
            `• <b>Exit Price:</b> $${formatChartPrice(curPrice)} (<b>+${pnlPct.toFixed(2)}%</b>)\n` +
            `• <b>Peak Gain (MFE):</b> +${maxProfitPct.toFixed(2)}%\n` +
            `• <b>Trade Duration:</b> ${durationStr}\n` +
            `• <b>Outcome:</b> Profit target fully achieved ✅`;

          sendTelegramAlert(
            tpMsg,
            m.strategy_name,
            'signal',
            monitorTopic,
            undefined,
            rootMsgId,
          ).catch((err) => console.warn('[signal-monitor] Failed to send TP alert:', err));
        }

        result.closed++;
        continue;
      }

      // ── 2. Check Stop Loss / Breakeven Exit ───────────────────────────────
      const isStopLossHit = isLong ? curPrice <= slPrice : curPrice >= slPrice;
      if (isStopLossHit) {
        const exitReason = m.is_breakeven_armed ? 'breakeven' : 'stop_loss';
        await db.query(
          `UPDATE signal_monitors
           SET status = 'closed', exit_reason = $1, exit_price = $2, exit_time = NOW(),
               max_price = $3, min_price = $4, max_profit_pct = $5, max_drawdown_pct = $6,
               last_checked_at = NOW()
           WHERE id = $7`,
          [exitReason, curPrice, maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
        );

        if (m.signal_id) {
          await db.query(
            `UPDATE strategy_signals
             SET actual_exit_price = $1, pnl_pct = $2, outcome_note = $3, outcome_at = NOW()
             WHERE id = $4`,
            [curPrice, pnlPct, `${exitReason} hit via monitor`, m.signal_id],
          ).catch((err) => console.warn('[signal-monitor] Failed to update strategy_signals exit:', err));
        }

        if (rootMsgId) {
          const exitLabel = m.is_breakeven_armed ? 'Breakeven Protected Exit 🛡️' : 'Stop Loss Hit 🛑';
          const slMsg =
            `${exitLabel}\n` +
            `• <b>Symbol:</b> ${m.symbol} (${m.timeframe.toUpperCase()} • ${m.direction.toUpperCase()})\n` +
            `• <b>Exit Price:</b> $${formatChartPrice(curPrice)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n` +
            `• <b>Peak Gain (MFE):</b> +${maxProfitPct.toFixed(2)}%\n` +
            `• <b>Trade Duration:</b> ${durationStr}\n` +
            `• <b>Summary:</b> ${m.is_breakeven_armed ? 'Exited with zero loss (protected at breakeven).' : 'Closed at risk stop boundary.'}`;

          sendTelegramAlert(
            slMsg,
            m.strategy_name,
            'signal',
            monitorTopic,
            undefined,
            rootMsgId,
          ).catch((err) => console.warn('[signal-monitor] Failed to send SL alert:', err));
        }

        result.closed++;
        continue;
      }

      // ── 3. Arm Breakeven (+1R or half-way to TP) ──────────────────────────
      const tpTargetPct = Math.abs(((tpPrice - entryPrice) / entryPrice) * 100);
      const breakevenThreshold = Math.max(1.0, tpTargetPct / 2);

      if (!m.is_breakeven_armed && pnlPct >= breakevenThreshold) {
        await db.query(
          `UPDATE signal_monitors
           SET is_breakeven_armed = TRUE, stop_loss_price = breakeven_price,
               max_price = $1, min_price = $2, max_profit_pct = $3, max_drawdown_pct = $4,
               last_checked_at = NOW()
           WHERE id = $5`,
          [maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
        );

        if (rootMsgId) {
          const beMsg =
            `📍 <b>Milestone: +${pnlPct.toFixed(1)}% Reached</b>\n` +
            `• <b>Symbol:</b> ${m.symbol} (${m.timeframe.toUpperCase()})\n` +
            `• <b>Current Price:</b> $${formatChartPrice(curPrice)}\n` +
            `• <b>Action:</b> Stop Loss automatically moved to <b>Breakeven ($${formatChartPrice(entryPrice)})</b>.\n` +
            `• <b>Trade Status:</b> Risk-free runner active 🛡️`;

          sendTelegramAlert(
            beMsg,
            m.strategy_name,
            'signal',
            monitorTopic,
            undefined,
            rootMsgId,
          ).catch((err) => console.warn('[signal-monitor] Failed to send BE alert:', err));
        }

        result.breakevenArmed++;
        continue;
      }

      // ── 4. Check 48h Max Duration Expiry ──────────────────────────────────
      const createdAtMs = new Date(m.created_at).getTime();
      if (durationMs >= MAX_MONITOR_DURATION_MS) {
        await db.query(
          `UPDATE signal_monitors
           SET status = 'closed', exit_reason = 'time_expired', exit_price = $1, exit_time = NOW(),
               max_price = $2, min_price = $3, max_profit_pct = $4, max_drawdown_pct = $5,
               last_checked_at = NOW()
           WHERE id = $6`,
          [curPrice, maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
        );

        if (m.signal_id) {
          await db.query(
            `UPDATE strategy_signals
             SET actual_exit_price = $1, pnl_pct = $2, outcome_note = '48h monitor window expired', outcome_at = NOW()
             WHERE id = $3`,
            [curPrice, pnlPct, m.signal_id],
          ).catch((err) => console.warn('[signal-monitor] Failed to update strategy_signals exit:', err));
        }

        if (rootMsgId) {
          const expMsg =
            `⏱️ <b>48h Monitoring Complete (Final Summary)</b>\n` +
            `• <b>Symbol:</b> ${m.symbol} (${m.timeframe.toUpperCase()} • ${m.direction.toUpperCase()})\n` +
            `• <b>Final Price:</b> $${formatChartPrice(curPrice)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n` +
            `• <b>Peak Gain (MFE):</b> +${maxProfitPct.toFixed(2)}%\n` +
            `• <b>Protected:</b> ${m.is_breakeven_armed ? 'Yes (SL @ BE)' : `No (SL @ $${formatChartPrice(slPrice)})`}\n` +
            `• <b>Duration:</b> ${durationStr}\n` +
            `• <b>Status:</b> Auto-closed after 48h window`;

          sendTelegramAlert(
            expMsg,
            m.strategy_name,
            'signal',
            monitorTopic,
            undefined,
            rootMsgId,
          ).catch((err) => console.warn('[signal-monitor] Failed to send 48h expiry alert:', err));
        }

        result.closed++;
        continue;
      }

      // ── 5. Tiered Heartbeat (15m, 30m, 60m, then every 4h in 48h) ─────────
      const lastHbMs = m.last_heartbeat_at ? new Date(m.last_heartbeat_at).getTime() : createdAtMs;
      const lastHbOffsetMs = Math.max(0, lastHbMs - createdAtMs);
      const nextMilestoneMs = getNextHeartbeatMilestoneMs(lastHbOffsetMs, durationMs);

      if (nextMilestoneMs !== null && durationMs >= nextMilestoneMs) {
        await db.query(
          `UPDATE signal_monitors
           SET last_heartbeat_at = NOW(), max_price = $1, min_price = $2,
               max_profit_pct = $3, max_drawdown_pct = $4, last_checked_at = NOW()
           WHERE id = $5`,
          [maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
        );

        if (rootMsgId) {
          const milestoneLabel = formatTradeDuration(nextMilestoneMs);
          const hbMsg =
            `📊 <b>Progress Update (${milestoneLabel} Check-in • ${m.timeframe.toUpperCase()})</b>\n` +
            `• <b>Symbol:</b> ${m.symbol} (${m.direction.toUpperCase()})\n` +
            `• <b>Current Price:</b> $${formatChartPrice(curPrice)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)\n` +
            `• <b>Peak Gain (MFE):</b> +${maxProfitPct.toFixed(2)}%\n` +
            `• <b>Protected:</b> ${m.is_breakeven_armed ? 'Yes (SL @ BE)' : `No (SL @ $${formatChartPrice(slPrice)})`}\n` +
            `• <b>Duration:</b> ${durationStr}`;

          sendTelegramAlert(
            hbMsg,
            m.strategy_name,
            'signal',
            monitorTopic,
            undefined,
            rootMsgId,
          ).catch((err) => console.warn('[signal-monitor] Failed to send heartbeat alert:', err));
        }

        result.heartbeatsSent++;
        continue;
      }

      // Default state touch (keep max/min metrics updated)
      await db.query(
        `UPDATE signal_monitors
         SET max_price = $1, min_price = $2, max_profit_pct = $3, max_drawdown_pct = $4,
             last_checked_at = NOW()
         WHERE id = $5`,
        [maxPrice, minPrice, maxProfitPct, maxDrawdownPct, m.id],
      );
    }

    return result;
  } catch (err) {
    console.error('[signal-monitor] runSignalMonitorCheck error:', err);
    return result;
  }
}
