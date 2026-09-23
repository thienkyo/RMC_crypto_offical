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
import { isEquitySymbol } from '@/lib/exchange/equities';
import { buildIndicatorCache, evaluateConditionGroupsChecked } from './evaluate';
import { buildMtfIndicatorCache, hasHtfConditions, type HtfCandleSets } from './mtf';
import { computeMetrics } from './metrics';
import { computeEntryPriceLimit, isMarketFill } from './entryPrice';

export interface BacktestOptions {
  /** Starting portfolio value in quote currency. Default: 10 000. */
  initialCapital?: number;
  /** Fee preset model: 'futures' (Binance USDT-M), 'spot', or 'custom'. */
  feeModel?: 'futures' | 'spot' | 'custom';
  /** Maker fee percentage (for resting limit orders). Default: 0.02% (futures). */
  makerFeePct?: number;
  /** Taker fee percentage (for market orders). Default: 0.05% (futures). */
  takerFeePct?: number;
  /** Base market order slippage percentage. Default: 0.02%. */
  slippagePct?: number;
  /** Extra slippage penalty on stop-loss market fills during volatility. Default: 0.05%. */
  stopLossSlippagePct?: number;
  /** 8-hour perpetual funding rate as percentage, e.g. 0.01 for 0.01%. Default: 0.01%. */
  fundingRate8hPct?: number;
  /** When true, calculates 8-hour funding rate drag on perpetual futures. Default: true for crypto, false for equities. */
  enableFunding?: boolean;
  /** Legacy fallback: sets maker and taker fee to feePct if provided. */
  feePct?: number;
  /** Multi-timeframe: optional map of timeframe -> candles arrays for MTF conditions. */
  htfCandles?: HtfCandleSets;
}

const EIGHT_HOURS_MS = 28_800_000;

export function runBacktest(
  strategy: Strategy,
  candles: Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  const isEquity = isEquitySymbol(strategy.symbol);

  const {
    initialCapital      = 10_000,
    feeModel            = isEquity ? 'spot' : 'futures',
    makerFeePct         = options.feePct ?? (feeModel === 'spot' ? 0.1 : 0.02),
    takerFeePct         = options.feePct ?? (feeModel === 'spot' ? 0.1 : 0.05),
    slippagePct         = options.slippagePct ?? (feeModel === 'spot' ? 0.05 : 0.02),
    stopLossSlippagePct = 0.05,
    fundingRate8hPct    = isEquity ? 0 : (options.fundingRate8hPct ?? 0.01),
    enableFunding       = isEquity ? false : (options.enableFunding ?? true),
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
  const cache = hasHtfConditions(strategy)
    ? buildMtfIndicatorCache(strategy, candles, options.htfCandles ?? {})
    : buildIndicatorCache(allConditions, candles);

  // ── Constants ─────────────────────────────────────────────────────────────
  const direction                             = strategy.action.type === 'enter_long' ? 'long' : 'short';
  const { positionSizePct, maxPositions = 1 } = strategy.action;
  const { stopLossPct, takeProfitPct }        = strategy.risk;

  // Decimal rates
  const makerFeeRate  = makerFeePct / 100;
  const takerFeeRate  = takerFeePct / 100;
  const baseSlipRate  = slippagePct / 100;
  const slSlipRate    = (slippagePct + stopLossSlippagePct) / 100;

  // ── State ──────────────────────────────────────────────────────────────────

  const trades: BacktestTrade[]    = [];
  const equityCurve: EquityPoint[] = [];
  let capital = initialCapital;
  let tradeId = 0;

  /** A single open position with entry execution details. */
  interface OpenPos {
    entryPrice:        number;
    rawEntryPrice:     number;
    entryTime:         number;
    allocated:         number;
    isLimit:           boolean;
    entryFeePaid:      number;
    entrySlippagePaid: number;
  }

  interface PendingLimit {
    limitPrice: number;
  }

  /** Currently open positions, oldest first. */
  let openPositions: OpenPos[]     = [];
  let pendingLimit:  PendingLimit | null = null;

  const entryOffset = strategy.action.entryPriceOffset;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openPos(fillPrice: number, time: number, isLimit: boolean): void {
    const allocated = capital * (positionSizePct / 100);
    const feeRate   = isLimit ? makerFeeRate : takerFeeRate;
    const slipRate  = isLimit ? 0 : baseSlipRate;
    const totalSide = feeRate + slipRate;

    const effEntry = direction === 'long'
      ? fillPrice * (1 + totalSide)
      : fillPrice * (1 - totalSide);

    openPositions.push({
      entryPrice: effEntry,
      rawEntryPrice: fillPrice,
      entryTime: time,
      allocated,
      isLimit,
      entryFeePaid: allocated * feeRate,
      entrySlippagePaid: allocated * slipRate,
    });
  }

  function closePos(pos: OpenPos, fillPrice: number, time: number, reason: ExitReason): void {
    // Determine fee and slippage tier based on order type
    let feeRate  = takerFeeRate;
    let slipRate = baseSlipRate;

    if (reason === 'take_profit') {
      // Resting limit TP order fills as Maker with 0 slippage
      feeRate  = makerFeeRate;
      slipRate = 0;
    } else if (reason === 'stop_loss') {
      // Stop-loss market fill suffers elevated volatility slippage
      feeRate  = takerFeeRate;
      slipRate = slSlipRate;
    }

    const totalSide = feeRate + slipRate;

    // Fee decreases effective exit price for longs, increases for shorts
    const exitPrice = direction === 'long'
      ? fillPrice * (1 - totalSide)
      : fillPrice * (1 + totalSide);

    const exitFeePaid      = pos.allocated * feeRate;
    const exitSlippagePaid = pos.allocated * slipRate;

    // ── Price P&L on allocated capital ──
    const pricePnlPct =
      direction === 'long'
        ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100
        : ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100;

    let tradePnlAbs = pos.allocated * (pricePnlPct / 100);

    // ── Compounding 8-hour Perpetual Funding Calculation ──
    let fundingCost = 0;
    if (enableFunding && fundingRate8hPct !== 0) {
      const intervals = Math.floor(time / EIGHT_HOURS_MS) - Math.floor(pos.entryTime / EIGHT_HOURS_MS);
      if (intervals > 0) {
        const totalFundingRate = (fundingRate8hPct / 100) * intervals;
        // Longs pay positive funding; shorts receive positive funding
        fundingCost = direction === 'long'
          ? pos.allocated * totalFundingRate
          : -pos.allocated * totalFundingRate;
      }
    }

    // Net P&L after funding
    const netPnlAbs = tradePnlAbs - fundingCost;
    const netPnlPct = (netPnlAbs / pos.allocated) * 100;

    capital += netPnlAbs;

    trades.push({
      id:              ++tradeId,
      entryTime:       pos.entryTime,
      exitTime:        time,
      entryPrice:      pos.entryPrice,
      exitPrice,
      direction,
      positionSizePct,
      pnlPct:          netPnlPct,
      pnlAbs:          netPnlAbs,
      exitReason:      reason,
      feesPaid:        pos.entryFeePaid + exitFeePaid,
      fundingPaid:     fundingCost,
      slippagePaid:    pos.entrySlippagePaid + exitSlippagePaid,
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
        openPos(fillPrice, candle.openTime, true);
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
        openPos(candle.close, candle.openTime, false);
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
