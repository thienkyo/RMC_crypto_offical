/**
 * Paper-trade backtester.
 *
 * Loop model (three phases per bar, left to right):
 *   Phase 1 — SL / TP: checked independently for every open position.
 *             Fill uses bar OPEN as worst-case gap protection.
 *   Phase 2 — Exit signal: closes ALL remaining open positions at bar CLOSE.
 *   Phase 3 — Entry signal: opens one new position if below maxPositions cap.
 *
 * Multi-position mode:
 *   strategy.action.maxPositions > 1 allows holding multiple concurrent
 *   positions.  Each fires its own SL/TP independently; a single exit signal
 *   closes all of them at once.
 *
 * Fee model:
 *   - Entry fee deducted from effective entry price (paid on the way in).
 *   - Exit fee deducted from effective exit price (paid on the way out).
 *   - Total round-trip cost ≈ 2 × (feePct + slippagePct).
 *
 * P&L accounting:
 *   - Only the allocated slice (positionSizePct % of current capital) is at risk.
 *   - pnlAbs is added / subtracted from capital after every closed position.
 */

import type { Candle } from '@/types/market';
import type {
  Strategy,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  ExitReason,
} from '@/types/strategy';
import { buildIndicatorCache, evaluateConditionGroupsChecked } from './evaluate';
import { computeMetrics } from './metrics';
import { computeEntryPriceLimit, isMarketFill } from './entryPrice';

export interface BacktestOptions {
  /** Starting portfolio value in quote currency. Default: 10 000. */
  initialCapital?: number;
  /** Taker fee percentage per side, e.g. 0.1 for 0.1%. Default: 0.1. */
  feePct?: number;
  /** Slippage as percentage per side, e.g. 0.05 for 0.05%. Default: 0.05. */
  slippagePct?: number;
}

export function runBacktest(
  strategy: Strategy,
  candles: Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  const {
    initialCapital = 10_000,
    feePct         = 0.1,
    slippagePct    = 0.05,
  } = options;

  const makeEmptyResult = (): BacktestResult => ({
    strategyId:   strategy.id,
    symbol:       strategy.symbol,
    timeframe:    strategy.timeframe,
    ranAt:        Date.now(),
    startTime:    candles[0]?.openTime  ?? 0,
    endTime:      candles[candles.length - 1]?.closeTime ?? 0,
    trades:       [],
    equityCurve:  [],
    metrics:      computeMetrics([], [], initialCapital),
  });

  if (candles.length < 2) return makeEmptyResult();

  // ── Pre-compute all indicator series ───────────────────────────────────────
  const allConditions = [
    ...strategy.entryConditions.flatMap((g) => g.conditions),
    ...strategy.exitConditions.flatMap((g) => g.conditions),
  ];
  const cache = buildIndicatorCache(allConditions, candles);

  // ── Constants ─────────────────────────────────────────────────────────────
  const direction                             = strategy.action.type === 'enter_long' ? 'long' : 'short';
  const { positionSizePct, maxPositions = 1 } = strategy.action;
  const { stopLossPct, takeProfitPct }        = strategy.risk;
  // One-way fee (entry or exit), as a decimal
  const sideFee = (feePct + slippagePct) / 100;

  // ── State ──────────────────────────────────────────────────────────────────

  const trades: BacktestTrade[]    = [];
  const equityCurve: EquityPoint[] = [];
  let capital = initialCapital;
  let tradeId = 0;

  /** A single open position; entryPrice already includes the entry-side fee. */
  interface OpenPos {
    entryPrice: number;
    entryTime:  number;
  }

  /**
   * A pending limit order placed when an entry signal fired but the limit has
   * not yet been touched by a subsequent bar.  NULL = no pending order.
   *
   * The limit is cancelled if:
   *   • The bar's price action fills it  → becomes an open position
   *   • An exit signal fires             → cancelled (no position opened)
   * It is never force-filled at end-of-data.
   */
  interface PendingLimit {
    limitPrice: number;
  }

  /** Currently open positions, oldest first. */
  let openPositions: OpenPos[]     = [];
  let pendingLimit:  PendingLimit | null = null;

  const entryOffset = strategy.action.entryPriceOffset;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openPos(fillPrice: number, time: number): void {
    const effEntry = direction === 'long'
      ? fillPrice * (1 + sideFee)
      : fillPrice * (1 - sideFee);
    openPositions.push({ entryPrice: effEntry, entryTime: time });
  }

  function closePos(pos: OpenPos, fillPrice: number, time: number, reason: ExitReason): void {
    // Fee decreases effective exit price for longs, increases for shorts
    const exitPrice = direction === 'long'
      ? fillPrice * (1 - sideFee)
      : fillPrice * (1 + sideFee);

    const allocated = capital * (positionSizePct / 100);

    const pnlPct =
      direction === 'long'
        ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
        : ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100;

    const pnlAbs = allocated * (pnlPct / 100);
    capital += pnlAbs;

    trades.push({
      id:             ++tradeId,
      entryTime:      pos.entryTime,
      exitTime:       time,
      entryPrice:     pos.entryPrice,
      exitPrice,
      direction,
      positionSizePct,
      pnlPct,
      pnlAbs,
      exitReason:     reason,
    });
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  for (let i = 1; i < candles.length; i++) {
    const candle     = candles[i]!;
    const prevCandle = candles[i - 1]!;

    // Record equity at this bar's open (before any trade on this bar)
    equityCurve.push({ time: candle.openTime, value: capital });

    // ── Phase 1: SL / TP for each open position independently ───────────────
    if (openPositions.length > 0) {
      const surviving: OpenPos[] = [];

      for (const pos of openPositions) {
        let closed = false;

        // Stop-loss (worst-case fill: bar open if gapped through SL)
        if (!closed && stopLossPct > 0) {
          const slPrice =
            direction === 'long'
              ? pos.entryPrice * (1 - stopLossPct / 100)
              : pos.entryPrice * (1 + stopLossPct / 100);

          const triggered =
            direction === 'long'
              ? candle.low  <= slPrice
              : candle.high >= slPrice;

          if (triggered) {
            const fillPrice =
              direction === 'long'
                ? Math.min(candle.open, slPrice)
                : Math.max(candle.open, slPrice);
            closePos(pos, fillPrice, candle.openTime, 'stop_loss');
            closed = true;
          }
        }

        // Take-profit
        if (!closed && takeProfitPct > 0) {
          const tpPrice =
            direction === 'long'
              ? pos.entryPrice * (1 + takeProfitPct / 100)
              : pos.entryPrice * (1 - takeProfitPct / 100);

          const triggered =
            direction === 'long'
              ? candle.high >= tpPrice
              : candle.low  <= tpPrice;

          if (triggered) {
            const fillPrice =
              direction === 'long'
                ? Math.max(candle.open, tpPrice)
                : Math.min(candle.open, tpPrice);
            closePos(pos, fillPrice, candle.openTime, 'take_profit');
            closed = true;
          }
        }

        if (!closed) surviving.push(pos);
      }

      openPositions = surviving;
    }

    // ── Phase 2: Exit signal — close ALL remaining open positions ────────────
    //   Also cancels any pending limit order: the exit condition says the
    //   trade thesis has changed, so we don't want a stale limit filling later.
    if (
      openPositions.length > 0 &&
      evaluateConditionGroupsChecked(strategy.exitConditions, candles, i, cache)
    ) {
      for (const pos of openPositions) {
        closePos(pos, candle.close, candle.openTime, 'signal');
      }
      openPositions = [];
      pendingLimit  = null;
    }

    // ── Phase 3a: Check if the pending limit order fills on this bar ─────────
    //   Fill rule (matches exchange limit-order semantics):
    //     Long:  bar.low  <= limitPrice → fill at min(bar.open, limitPrice)
    //     Short: bar.high >= limitPrice → fill at max(bar.open, limitPrice)
    //   If the bar gapped through the limit (open already past it), fill at open
    //   (better than the limit, so we use the open price).
    if (pendingLimit !== null && openPositions.length < maxPositions) {
      const { limitPrice } = pendingLimit;
      const fills =
        direction === 'long'
          ? candle.low  <= limitPrice
          : candle.high >= limitPrice;

      if (fills) {
        const fillPrice =
          direction === 'long'
            ? Math.min(candle.open, limitPrice)
            : Math.max(candle.open, limitPrice);
        openPos(fillPrice, candle.openTime);
        pendingLimit = null;
      }
    }

    // ── Phase 3b: Entry signal ────────────────────────────────────────────────
    //   Don't stack limit orders: skip if one is already pending.
    //   Market fill (offset === 0 or absent): fill immediately at bar close.
    //   Limit fill: store a pending limit; it fills when a subsequent bar
    //   touches the price (Phase 3a above).
    if (
      openPositions.length < maxPositions &&
      pendingLimit === null &&
      evaluateConditionGroupsChecked(strategy.entryConditions, candles, i, cache)
    ) {
      if (isMarketFill(entryOffset)) {
        // Market fill — same behaviour as before this feature was added
        openPos(candle.close, candle.openTime);
      } else {
        // Place a limit order; it fills when a future bar's range touches limitPrice
        pendingLimit = {
          limitPrice: computeEntryPriceLimit(candle.close, entryOffset, direction),
        };
      }
    }
  }

  // ── Close any positions still open at end of data ─────────────────────────
  if (openPositions.length > 0) {
    const last = candles[candles.length - 1]!;
    for (const pos of openPositions) {
      closePos(pos, last.close, last.closeTime, 'end_of_data');
    }
  }

  return {
    strategyId:  strategy.id,
    symbol:      strategy.symbol,
    timeframe:   strategy.timeframe,
    ranAt:       Date.now(),
    startTime:   candles[0]!.openTime,
    endTime:     candles[candles.length - 1]!.closeTime,
    trades,
    equityCurve,
    metrics:     computeMetrics(trades, equityCurve, initialCapital),
  };
}
