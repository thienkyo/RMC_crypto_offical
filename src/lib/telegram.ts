/**
 * Telegram alert delivery.
 *
 * Routing rule (from settings page):
 *   alert/strategy name contains "test" (case-insensitive)
 *     → personal chat IDs  (your own user ID — for testing)
 *   otherwise
 *     → group chat IDs     (group/channel — live signals)
 *
 * Chat IDs are read from the `settings` DB table on every call so you can
 * update them from the Settings page without restarting the server.
 * Bot token stays in TELEGRAM_BOT_TOKEN (.env.local) — it's a real secret.
 */

import { db } from '@/lib/db/client';

const TELEGRAM_API = 'https://api.telegram.org';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a stored chat-ID string (one per line, or comma-separated) into an
 * array of trimmed, non-empty strings ready to pass to the Telegram API.
 */
export function parseChatIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns true when the name should route to personal (test) chat IDs.
 * Matches any occurrence of the word "test" regardless of case or position.
 */
export function isTestTarget(name: string): boolean {
  return /test/i.test(name);
}

// ── Core send ─────────────────────────────────────────────────────────────────

/**
 * Low-level: send a message to a single Telegram chat.
 * Supports HTML parse_mode so callers can bold/italic key values.
 */
async function sendToChat(
  botToken: string,
  chatId:   string,
  text:     string,
): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status} for chat ${chatId}: ${body.slice(0, 200)}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an alert message, routing to the correct chat IDs based on `targetName`.
 *
 * - `targetName` is typically the alert rule name or strategy name.
 * - If it contains "test" (case-insensitive) → personal IDs.
 * - Otherwise → group IDs.
 * - All matching IDs receive the message in parallel.
 * - If *all* sends fail the function throws; if only *some* fail it logs
 *   warnings but resolves (partial delivery is better than total silence).
 *
 * @param message    HTML-formatted message body (Telegram supports basic HTML tags).
 * @param targetName Alert/strategy name used to determine routing.
 */
export async function sendTelegramAlert(
  message:    string,
  targetName: string,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN is not set. Add it to .env.local and restart the server.',
    );
  }

  // ── Load chat IDs from DB ─────────────────────────────────────────────────
  const { rows } = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM settings
     WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id')`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const personalIds = parseChatIds(map['telegram_personal_chat_id']);
  const groupIds    = parseChatIds(map['telegram_group_chat_id']);

  // ── Route ─────────────────────────────────────────────────────────────────
  const isTest  = isTestTarget(targetName);
  const chatIds = isTest ? personalIds : groupIds;
  const channel = isTest ? 'personal' : 'group';

  if (chatIds.length === 0) {
    console.warn(
      `[telegram] No ${channel} chat IDs configured — ` +
      `message for "${targetName}" not sent. Add them on the Settings page.`,
    );
    return;
  }

  console.log(
    `[telegram] Sending to ${chatIds.length} ${channel} chat(s) ` +
    `(target: "${targetName}", isTest: ${isTest})`,
  );

  // ── Send in parallel ──────────────────────────────────────────────────────
  const results = await Promise.allSettled(
    chatIds.map((id) => sendToChat(botToken, id, message)),
  );

  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );

  if (failures.length === results.length) {
    // Every send failed — surface the first error so callers can react
    throw new Error(
      `All ${channel} Telegram sends failed: ${String(failures[0]!.reason)}`,
    );
  }

  // Partial failure — log each and continue (some recipients got it)
  for (const f of failures) {
    console.warn('[telegram] Partial send failure:', f.reason);
  }
}

/**
 * Convenience wrapper: send to personal chat IDs unconditionally.
 * Useful for system notifications that are always personal (e.g. DB errors).
 */
export async function sendTelegramPersonal(message: string): Promise<void> {
  // Prefix "test" so the routing in sendTelegramAlert goes to personal IDs
  return sendTelegramAlert(message, 'test-system');
}
