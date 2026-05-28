/**
 * Telegram bot client for RMC alert delivery.
 *
 * Required env var (server-side only):
 *   TELEGRAM_BOT_TOKEN   — from @BotFather (/newbot)
 *
 * Chat IDs are stored in the `settings` DB table and managed via the Settings
 * page — no redeploy needed when you change them.
 *
 * Routing rule:
 *   alert/strategy name contains "test" (case-insensitive)
 *     → personal chat IDs  (visible only to you)
 *   otherwise
 *     → group chat IDs     (broadcast to group/channel)
 */

import { db } from '@/lib/db/client';
import { parseChatIds, isTestTarget } from '@/lib/telegram';
export { strategyRating } from '@/lib/strategy/rating';

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramSendResult {
  ok: boolean;
  /** Number of chats successfully delivered to. */
  delivered?: number;
  /** First error encountered, if any. */
  error?: string;
}

/**
 * Send an HTML-mode message, routing to personal or group chat IDs based on
 * `targetName` (alert rule name or strategy name).
 *
 * - Name contains "test" (case-insensitive) → personal chat IDs
 * - Otherwise → group chat IDs
 *
 * Returns ok:true as long as at least one delivery succeeded. Never throws.
 */
/**
 * Send an HTML-mode message, routing to the appropriate chat IDs.
 *
 * Routing priority (highest first):
 *   1. Name contains "test" (case-insensitive) → Test chat IDs
 *   2. channel === 'alert'                     → Alert chat IDs
 *   3. channel === 'signal' (default)          → Signal chat IDs
 *
 * Returns ok:true as long as at least one delivery succeeded. Never throws.
 */
export async function sendTelegramAlert(
  text:       string,
  targetName: string,
  channel:    'signal' | 'alert' = 'signal',
): Promise<TelegramSendResult> {
  if (!BOT_TOKEN) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set in .env.local' };
  }

  // ── Load chat IDs from DB ─────────────────────────────────────────────────
  let testIds:   string[] = [];
  let signalIds: string[] = [];
  let alertIds:  string[] = [];
  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings
       WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id', 'telegram_alert_chat_id')`,
    );
    const map  = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    testIds    = parseChatIds(map['telegram_personal_chat_id']);
    signalIds  = parseChatIds(map['telegram_group_chat_id']);
    alertIds   = parseChatIds(map['telegram_alert_chat_id']);
  } catch (err) {
    return { ok: false, error: `Failed to load chat IDs from DB: ${String(err)}` };
  }

  // ── Route ─────────────────────────────────────────────────────────────────
  const isTest = isTestTarget(targetName);
  let chatIds: string[];
  let channelLabel: string;

  if (isTest) {
    chatIds      = testIds;
    channelLabel = 'test';
  } else if (channel === 'alert') {
    chatIds      = alertIds;
    channelLabel = 'alert';
  } else {
    chatIds      = signalIds;
    channelLabel = 'signal';
  }

  if (chatIds.length === 0) {
    const msg = `No ${channelLabel} chat IDs configured — add them on the Settings page`;
    console.warn(`[telegram] ${msg} (target: "${targetName}")`);
    return { ok: false, error: msg };
  }

  console.log(
    `[telegram] "${targetName}" → ${channelLabel} (${chatIds.length} chat(s), isTest=${isTest})`,
  );

  // ── Send in parallel ──────────────────────────────────────────────────────
  let delivered  = 0;
  let firstError: string | undefined;

  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
          const errMsg  = (payload['description'] as string | undefined) ?? `HTTP ${res.status}`;
          console.error(`[telegram] Failed to deliver to ${chatId}: ${errMsg}`);
          firstError ??= `chat ${chatId}: ${errMsg}`;
        } else {
          delivered++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[telegram] Exception delivering to ${chatId}: ${errMsg}`);
        firstError ??= `chat ${chatId}: ${errMsg}`;
      }
    }),
  );

  return delivered > 0
    ? { ok: true, delivered }
    : { ok: false, error: firstError ?? 'All deliveries failed', delivered: 0 };
}

// ─── Message formatters ───────────────────────────────────────────────────────

/**
 * Indicator alert message.
 *
 * 🔔 Indicator Alert
 * Symbol:    BTCUSDT  |  1h
 * Indicator: RSI(14)
 * Trigger:   RSI crossed below 30  →  28.4
 * Price:     $62,840
 * Time:      2026-05-08 14:35 UTC
 */
export function formatAlertMessage(opts: {
  symbol:        string;
  timeframe:     string;
  indicatorName: string;  // e.g. "RSI(14)" or "Price"
  triggerDesc:   string;  // e.g. "RSI crossed below 30"
  currentValue:  number;  // e.g. 28.4
  price:         number;  // close price of the triggering candle
  timestamp:     number;  // Unix ms of the candle open time
}): string {
  const { symbol, timeframe, indicatorName, triggerDesc, currentValue, price, timestamp } = opts;

  const W = 11; // label column width (longest label is "Indicator:" = 10 + 1 space)
  const lines = [
    '🔔 Indicator Alert',
    `${lbl('Symbol:', W)}${symbol}  |  ${timeframe}`,
    `${lbl('Indicator:', W)}${indicatorName}`,
    `${lbl('Trigger:', W)}${triggerDesc}  →  ${fmtValue(currentValue)}`,
    `${lbl('Price:', W)}${fmtPrice(price)}`,
    `${lbl('Time:', W)}${fmtLocal(timestamp)}`,
  ];

  return `<pre>${lines.map(esc).join('\n')}</pre>`;
}

/**
 * One condition group as passed to the signal message formatter.
 * The group at index 0 is always OR; subsequent groups may be OR or AND.
 */
export interface ConditionGroupDisplay {
  /** Inter-group role: 'or' = alternative setup, 'and' = required filter. */
  groupOperator:     'or' | 'and';
  /** How conditions inside are combined. */
  conditionOperator: 'and' | 'or';
  /** Optional human label for the group. */
  label?:            string;
  /** Structured conditions with pass/fail state, live value, and check metadata. */
  conditions: Array<{
    label:         string;
    passed:        boolean;
    value?:        number;
    checkCandles?: number;
    checkMode?:    'confirmation' | 'lookback';
  }>;
}

/**
 * Strategy signal message — new format with icons, entry price, and
 * only the fired groups shown (highest-scoring first).
 *
 * 📈 Strategy Signal — "L_BTC"
 * 🏅 Rating:    ⭐⭐⭐⭐
 * 🪙 Symbol:    BTCUSDT  |  4h
 * 📡 Signal:    🟢 LONG ENTRY
 * 💵 Price:     $74,449
 * 🎯 Entry:     $72,216
 * 🛡 SL:        $70,050  (-3.0%)
 * 🏆 TP:        $75,827  (+5.0%)
 * 🕯 Candle:    2026-05-28 07:00 (UTC+7)
 *
 *   [BBRSI] ⭐⭐
 * ✅     RSI(14) < 40  →  30.22
 * ✅ AND BBPCT(14,2) < 0.09  →  -0.0022  c2
 */
export function formatStrategySignalMessage(opts: {
  strategyName:     string;
  longName?:        string;
  /** Per-signal score from signalScore() — 1–7 stars. */
  rating:           number;
  symbol:           string;
  timeframe:        string;
  direction:        'long' | 'short';
  entryPrice:       number;
  /** Limit-order price = entryPrice × 0.97. Omit to hide the Entry line. */
  entryPriceLimit?: number;
  stopLossPct:      number;
  takeProfitPct:    number;
  conditionGroups:  ConditionGroupDisplay[];
  timestamp:        number;
}): string {
  const {
    strategyName, rating, symbol, timeframe, direction,
    entryPrice, entryPriceLimit, stopLossPct, takeProfitPct,
    conditionGroups, timestamp,
  } = opts;

  const W        = 9;  // label field width after icon (icon = 1 emoji + 1 space)
  const isLong   = direction === 'long';
  const stars    = '⭐'.repeat(Math.min(7, Math.max(1, rating)));
  const anchor   = entryPriceLimit ?? entryPrice;
  const slPrice  = stopLossPct   > 0 ? anchor * (isLong ? 1 - stopLossPct   / 100 : 1 + stopLossPct   / 100) : null;
  const tpPrice  = takeProfitPct > 0 ? anchor * (isLong ? 1 + takeProfitPct / 100 : 1 - takeProfitPct / 100) : null;

  // ── Header ─────────────────────────────────────────────────────────────────
  const lines: string[] = [
    `📈 Strategy Signal — "${strategyName}"`,
    `🏅 ${lbl('Rating:', W)}${stars}`,
    `🪙 ${lbl('Symbol:', W)}${symbol}  |  ${timeframe}`,
    `📡 ${lbl('Signal:', W)}${isLong ? '🟢' : '🔴'} ${isLong ? 'LONG ENTRY' : 'SHORT ENTRY'}`,
    `💵 ${lbl('Price:', W)}${fmtPrice(entryPrice)}`,
  ];

  if (entryPriceLimit != null) {
    lines.push(`🎯 ${lbl('Entry:', W)}${fmtPrice(entryPriceLimit)}`);
  }
  if (slPrice !== null) {
    lines.push(`🛡 ${lbl('SL:', W)}${fmtPrice(slPrice)}  (${isLong ? '-' : '+'}${stopLossPct.toFixed(1)}%)`);
  }
  if (tpPrice !== null) {
    lines.push(`🏆 ${lbl('TP:', W)}${fmtPrice(tpPrice)}  (${isLong ? '+' : '-'}${takeProfitPct.toFixed(1)}%)`);
  }
  lines.push(`🕯 ${lbl('Candle:', W)}${fmtLocal(timestamp)}`);

  // ── Condition groups ───────────────────────────────────────────────────────
  const orGroups  = conditionGroups.filter((g, i) => i === 0 || g.groupOperator === 'or');
  const andGroups = conditionGroups.filter((g, i) => i  > 0 && g.groupOperator === 'and');

  // Only fired OR groups (at least one condition passed)
  const firedOr = orGroups.filter((g) => g.conditions.some((c) => c.passed));

  function orScore(g: ConditionGroupDisplay): number {
    return g.conditions.filter((c) => c.passed).reduce((s, c) =>
      s + 1 + Math.max(0, (c.checkCandles ?? 1) - 1) * 0.5, 0);
  }

  // Sort highest score first
  const sortedOr = [...firedOr].sort((a, b) => orScore(b) - orScore(a));

  if (sortedOr.length > 0 || andGroups.length > 0) {
    lines.push('');

    for (let gi = 0; gi < sortedOr.length; gi++) {
      const g          = sortedOr[gi]!;
      const condOp     = g.conditionOperator.toUpperCase();
      const groupStars = '⭐'.repeat(Math.min(7, Math.max(1, Math.round(orScore(g)))));

      if (gi > 0) lines.push('── also fired ──');

      // Group label + per-group stars (only when there's a label or multiple groups)
      const hasLabel = !!g.label?.trim();
      if (hasLabel || sortedOr.length > 1) {
        const labelStr = hasLabel ? `[${g.label!.trim()}]` : '';
        lines.push(`  ${labelStr} ${groupStars}`.trimEnd());
      }

      // Only passed conditions; tick at line start
      let firstPassed = true;
      for (const cond of g.conditions) {
        if (!cond.passed) continue;
        const valSuffix   = cond.value !== undefined ? `  →  ${fmtValue(cond.value)}` : '';
        const checkSuffix = fmtCheckSuffix(cond.checkMode, cond.checkCandles);
        const opPrefix    = firstPassed ? '✅    ' : `✅ ${condOp} `;
        lines.push(`${opPrefix}${cond.label}${valSuffix}${checkSuffix}`);
        firstPassed = false;
      }
    }

    for (const g of andGroups) {
      lines.push('── AND filter ──');
      if (g.label?.trim()) lines.push(`  [${g.label.trim()}]`);
      const condOp    = g.conditionOperator.toUpperCase();
      let firstPassed = true;
      for (const cond of g.conditions) {
        const valSuffix   = cond.value !== undefined ? `  →  ${fmtValue(cond.value)}` : '';
        const checkSuffix = fmtCheckSuffix(cond.checkMode, cond.checkCandles);
        const opPrefix    = firstPassed ? '✅    ' : `✅ ${condOp} `;
        lines.push(`${opPrefix}${cond.label}${valSuffix}${checkSuffix}`);
        firstPassed = false;
      }
    }
  }

  return `<pre>${lines.map(esc).join('\n')}</pre>`;
}

/** Suffix like "  c2" or "  l3" — omitted when candles <= 1 (default). */
function fmtCheckSuffix(
  mode:    'confirmation' | 'lookback' | undefined,
  candles: number | undefined,
): string {
  const n = candles ?? 1;
  if (n <= 1) return '';
  return `  ${(mode ?? 'confirmation') === 'lookback' ? 'l' : 'c'}${n}`;
}


// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Left-pad a label to a fixed column width. */
function lbl(label: string, width: number): string {
  return label.padEnd(width);
}

/**
 * Escape HTML special chars for content inside a <pre> block.
 * Telegram HTML mode still requires & < > to be escaped inside <pre>.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format a price value: "$62,840" for large numbers, "$0.0423" for small ones. */
function fmtPrice(price: number): string {
  if (price >= 1000) {
    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (price >= 1) {
    return '$' + price.toFixed(2);
  }
  return '$' + price.toFixed(6);
}

/** Format an indicator value with adaptive precision. */
function fmtValue(v: number): string {
  if (Number.isNaN(v))   return '—';
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 1)   return v.toFixed(2);
  return v.toFixed(4);
}

/** Format a Unix-ms timestamp as "YYYY-MM-DD HH:MM (UTC+7)". */
function fmtLocal(ms: number): string {
  const d   = new Date(ms);
  d.setUTCHours(d.getUTCHours() + 7); // Convert to UTC+7
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (UTC+7)`
  );
}

// ─── Bot utilities ────────────────────────────────────────────────────────────

/**
 * Verify bot credentials by calling getMe.
 * Used by the /api/alerts/test endpoint.
 */
export async function verifyTelegramConfig(): Promise<{ ok: boolean; botName?: string; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set' };
  try {
    const res  = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string } };
    if (!data.ok) return { ok: false, error: 'Invalid bot token' };
    return { ok: true, botName: data.result?.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
