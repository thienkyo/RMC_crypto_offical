/**
 * Telegram routing helpers.
 *
 * Routing rule (from settings page):
 *   alert/strategy name contains "test" (case-insensitive)
 *     → personal chat IDs  (your own user ID — for testing)
 *   otherwise
 *     → group chat IDs     (group/channel — live signals)
 */

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
