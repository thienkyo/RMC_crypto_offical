/**
 * Raw strategy signal computation — client-safe, no server imports.
 *
 * Computes the set of closed candles where a strategy's entry conditions fired,
 * WITHOUT any position-management layer (SL/TP, one-position-at-a-time, etc.).
 *
 * These "raw signals" are distinct from backtest trades:
 *   • A backtest trade fires once per position cycle (entry → exit).
 *   • A raw signal fires on EVERY bar where conditions are met.
 *
 * Use raw signals to paint "this is when the notification would have triggered"
 * markers on the chart, giving a dense view of condition hits independent of
 * how position management would have filtered them.
 */

import { buildIndicatorCache, evaluateCondition } from '@/lib/strategy/evaluate';
import type { Strategy } from '@/types/strategy';
import type { Candle } from '@/types/market';

export interface RawSignal {
  openTimeMs: number;
  direction: 'long' | 'short';
}

/**
 * Return every closed candle (excluding the currently-forming bar) where
 * the strategy's entry conditions were met.
 *
 * Evaluation uses the same evaluateCondition() logic as the backtester —
 * single-candle check per bar, no multi-candle confirmation window.
 * (checkMode / checkCandles are notification-layer concerns, not chart display.)
 */
export function computeSignalCandles(strategy: Strategy, candles: Candle[]): RawSignal[] {
  const allConditions = strategy.entryConditions.flatMap((g) => g.conditions);
  if (allConditions.length === 0 || candles.length < 2) return [];

  const direction: 'long' | 'short' =
    strategy.action.type === 'enter_long' ? 'long' : 'short';

  let cache: Map<string, Map<number, number>>;
  try {
    cache = buildIndicatorCache(allConditions, candles);
  } catch {
    return [];
  }

  const signals: RawSignal[] = [];

  // candles.length - 1 skips the currently-forming bar (same convention as notify.ts).
  for (let i = 1; i < candles.length - 1; i++) {
    const candle = candles[i]!;
    const prev   = candles[i - 1]!;

    // ANY condition group (OR), ALL conditions within a group (AND)
    const fired = strategy.entryConditions.some((group) => {
      if (group.conditions.length === 0) return false;
      return group.conditions.every((c) => evaluateCondition(c, candle, prev, cache));
    });

    if (fired) signals.push({ openTimeMs: candle.openTime, direction });
  }

  return signals;
}
