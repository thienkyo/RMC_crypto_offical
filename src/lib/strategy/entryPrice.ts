/**
 * Entry price limit computation — pure, client-safe, no server imports.
 *
 * Shared between the backtester (client) and the notify cron (server) so the
 * limit price shown in Telegram exactly matches the price used in backtest fills.
 */

import type { EntryPriceOffset } from '@/types/strategy';

/** Default offset applied when a strategy has no explicit entryPriceOffset. */
export const DEFAULT_ENTRY_OFFSET: EntryPriceOffset = { mode: 'pct', value: 2 };

/**
 * Compute the limit entry price from a signal price and an offset config.
 *
 * Long:
 *   pct → signalPrice × (100 − value) / 100
 *   abs → signalPrice − value
 *
 * Short (mirrored — enter above signal price):
 *   pct → signalPrice × (100 + value) / 100
 *   abs → signalPrice + value
 *
 * Returns signalPrice unchanged when offset is absent or value === 0
 * (caller treats this as a market fill).
 */
export function computeEntryPriceLimit(
  signalPrice: number,
  offset:      EntryPriceOffset | undefined,
  direction:   'long' | 'short',
): number {
  // Resolve default: absent field → 2% limit
  const eff = offset ?? DEFAULT_ENTRY_OFFSET;

  if (eff.value === 0) return signalPrice;

  if (direction === 'long') {
    return eff.mode === 'pct'
      ? signalPrice * (100 - eff.value) / 100
      : signalPrice - eff.value;
  }

  // short
  return eff.mode === 'pct'
    ? signalPrice * (100 + eff.value) / 100
    : signalPrice + eff.value;
}

/**
 * Returns true when the offset is effectively disabled (market fill).
 * Convenient guard used in the backtester Phase 3 branch.
 */
export function isMarketFill(offset: EntryPriceOffset | undefined): boolean {
  const eff = offset ?? DEFAULT_ENTRY_OFFSET;
  return eff.value === 0;
}
