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
export async function sendTelegramAlert(
  text:       string,
  targetName: string,
): Promise<TelegramSendResult> {
  if (!BOT_TOKEN) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN not set in .env.local' };
  }

  // ── Load chat IDs from DB ─────────────────────────────────────────────────
  let personalIds: string[] = [];
  let groupIds:    string[] = [];
  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings
       WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id')`,
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    personalIds = parseChatIds(map['telegram_personal_chat_id']);
    groupIds    = parseChatIds(map['telegram_group_chat_id']);
  } catch (err) {
    return { ok: false, error: `Failed to load chat IDs from DB: ${String(err)}` };
  }

  // ── Route by name ─────────────────────────────────────────────────────────
  const isTest  = isTestTarget(targetName);
  const chatIds = isTest ? personalIds : groupIds;
  const channel = isTest ? 'personal' : 'group';

  if (chatIds.length === 0) {
    const msg = `No ${channel} chat IDs configured — add them on the Settings page`;
    console.warn(`[telegram] ${msg} (target: "${targetName}")`);
    return { ok: false, error: msg };
  }

  console.log(
    `[telegram] "${targetName}" → ${channel} (${chatIds.length} chat(s), isTest=${isTest})`,
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
  /** Structured conditions with pass/fail state and live value. */
  conditions:        Array<{ label: string; passed: boolean; value?: number }>;
}

/**
 * Strategy signal message.
 *
 * 📈 Strategy Signal — "RSI + EMA Pullback"
 * RSI oversold + EMA crossover — high confidence  ← longName (optional)
 * Rating:      ⭐⭐⭐
 * Symbol:      BTCUSDT  |  4h
 * Signal:      🟢 LONG ENTRY
 * Price:       $62,840
 * SL:          $61,200  (-2.6%)
 * TP:          $65,400  (+4.1%)
 * Candle:      2026-05-08 21:00 (UTC+7)
 *
 * Conditions:
 *   ✅ RSI(14) < 35
 *   AND ✅ MACD(12,26,9) < 0
 * ── OR ──
 *   ✅ Three Crows > 0
 * ── AND filter ──
 *   ✅ ADX(14) > 25
 *   OR ✅ BB%B(20,2) > 1.0
 */
export function formatStrategySignalMessage(opts: {
  strategyName:    string;
  /** Verbose name displayed in the Telegram message; falls back to strategyName. */
  longName?:       string;
  /** 1–7 star rating (computed from total entry condition count). */
  rating:          number;
  symbol:          string;
  timeframe:       string;
  direction:       'long' | 'short';
  entryPrice:      number;
  stopLossPct:     number;    // 0 = disabled
  takeProfitPct:   number;    // 0 = disabled
  /** Structured condition groups — carries AND/OR operator info. */
  conditionGroups: ConditionGroupDisplay[];
  timestamp:       number;    // Unix ms of the entry candle
}): string {
  const {
    strategyName, longName, rating, symbol, timeframe, direction,
    entryPrice, stopLossPct, takeProfitPct, conditionGroups, timestamp,
  } = opts;

  const W = 13; // label column width ("Take profit:" = 12 + 1 space)

  const isLong     = direction === 'long';
  const signalIcon = isLong ? '🟢' : '🔴';
  const signalText = isLong ? 'LONG ENTRY' : 'SHORT ENTRY';

  const slPrice = stopLossPct   > 0 ? entryPrice * (isLong ? 1 - stopLossPct / 100   : 1 + stopLossPct / 100)   : null;
  const tpPrice = takeProfitPct > 0 ? entryPrice * (isLong ? 1 + takeProfitPct / 100 : 1 - takeProfitPct / 100) : null;

  const stars = '⭐'.repeat(Math.min(7, Math.max(1, rating)));

  const lines: string[] = [`📈 Strategy Signal — "${strategyName}"`];

  const verboseName = longName?.trim();
  if (verboseName) lines.push(verboseName);

  lines.push(
    `${lbl('Rating:', W)}${stars}`,
    `${lbl('Symbol:', W)}${symbol}  |  ${timeframe}`,
    `${lbl('Signal:', W)}${signalIcon} ${signalText}`,
    `${lbl('Price:', W)}${fmtPrice(entryPrice)}`,
  );

  if (slPrice !== null) {
    lines.push(`${lbl('SL:', W)}${fmtPrice(slPrice)}  (${isLong ? '-' : '+'}${stopLossPct.toFixed(1)}%)`);
  }
  if (tpPrice !== null) {
    lines.push(`${lbl('TP:', W)}${fmtPrice(tpPrice)}  (${isLong ? '+' : '-'}${takeProfitPct.toFixed(1)}%)`);
  }

  lines.push(`${lbl('Candle:', W)}${fmtLocal(timestamp)}`);

  // ── Conditions block ───────────────────────────────────────────────────────
  const nonEmptyGroups = conditionGroups.filter((g) => g.conditions.length > 0);
  if (nonEmptyGroups.length > 0) {
    lines.push('');
    lines.push('Conditions:');

    for (let gi = 0; gi < nonEmptyGroups.length; gi++) {
      const group   = nonEmptyGroups[gi]!;
      const condOp  = group.conditionOperator.toUpperCase();

      // Inter-group separator (not before the first group)
      if (gi > 0) {
        const sep = group.groupOperator === 'and' ? '── AND filter ──' : '── OR ──';
        lines.push(sep);
      }

      // Optional group label
      if (group.label?.trim()) {
        lines.push(`  [${group.label.trim()}]`);
      }

      // Conditions with intra-group operator between them
      for (let ci = 0; ci < group.conditions.length; ci++) {
        const cond = group.conditions[ci]!;
        const icon = cond.passed ? '✅' : '⚪';
        const valSuffix = cond.value !== undefined ? `  →  ${fmtValue(cond.value)}` : '';
        const prefix = ci === 0 ? `  ${icon}` : `  ${condOp} ${icon}`;
        lines.push(`${prefix} ${cond.label}${valSuffix}`);
      }
    }
  }

  return `<pre>${lines.map(esc).join('\n')}</pre>`;
}

/**
 * Compute a 1–7 star rating from total entry condition count and confirmation periods.
 * More conditions + longer confirmations = harder to satisfy = higher-confidence signal = more stars.
 * Each additional confirmation candle adds 0.5 to the difficulty score.
 */
export function strategyRating(totalConditions: number, extraConfirmations: number = 0): number {
  const score = totalConditions + (extraConfirmations * 0.5);
  return Math.min(7, Math.max(1, Math.round(score)));
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
