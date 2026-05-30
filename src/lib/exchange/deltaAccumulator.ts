/**
 * Delta Accumulator — per-candle buy/sell volume tracking from aggTrades.
 *
 * The accumulator listens to the aggTrades WebSocket stream and bins each
 * trade into the correct candle bucket based on its timestamp and the active
 * timeframe.  On candle close, the accumulated buy/sell volumes are:
 *   1. Written to the candles table (buy_volume / sell_volume columns).
 *   2. Available in-memory via getCandelDelta() for real-time CVD rendering.
 *
 * IMPORTANT: This is a singleton per (symbol, timeframe) pair managed by the
 * React hook useDeltaAccumulator.  Never instantiate DeltaAccumulator directly
 * in a component — use the hook, which handles lifecycle correctly.
 *
 * CANDLE BINNING:
 *   Given a trade at time T and a timeframe with interval MS:
 *     candleOpenTime = floor(T / MS) × MS
 *   This matches Binance's own candle open-time calculation exactly.
 *
 * THREAD SAFETY:
 *   JavaScript is single-threaded, so no explicit locking is needed.
 *   The accumulator is designed for browser-side use only.
 */

import type { AggTrade } from './binance';
import type { Timeframe }  from '@/types/market';
import { TF_TO_MS }       from './binance';

export interface CandelDeltaBucket {
  openTime:   number;
  buyVolume:  number;
  sellVolume: number;
}

export class DeltaAccumulator {
  private readonly _tfMs:     number;
  /** In-memory map: candleOpenTime → bucket */
  private readonly _buckets:  Map<number, CandelDeltaBucket> = new Map();
  /** Called on every trade to allow external listeners (CVD indicator, DB write). */
  private _onTrade: ((bucket: CandelDeltaBucket, trade: AggTrade) => void) | null = null;

  constructor(timeframe: Timeframe) {
    this._tfMs = TF_TO_MS[timeframe];
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Feed an aggTrade message into the accumulator.
   * Call this from the subscribeAggTrades() callback.
   */
  ingest(trade: AggTrade): void {
    const candleOpenTime = Math.floor(trade.time / this._tfMs) * this._tfMs;

    let bucket = this._buckets.get(candleOpenTime);
    if (!bucket) {
      bucket = { openTime: candleOpenTime, buyVolume: 0, sellVolume: 0 };
      this._buckets.set(candleOpenTime, bucket);
    }

    // isBuyerMaker = true → the buyer is the maker (limit buy sitting in the book)
    // → the aggressive side is the SELLER (market sell).
    // isBuyerMaker = false → the seller is the maker → aggressive side is the BUYER.
    if (trade.isBuyerMaker) {
      bucket.sellVolume += trade.quoteQty;
    } else {
      bucket.buyVolume  += trade.quoteQty;
    }

    this._onTrade?.(bucket, trade);
  }

  /**
   * Register a callback fired on every ingested trade.
   * Use to drive real-time CVD updates or async DB writes.
   */
  onTrade(cb: (bucket: CandelDeltaBucket, trade: AggTrade) => void): void {
    this._onTrade = cb;
  }

  /**
   * Get the accumulated bucket for a specific candle open time.
   * Returns null if no trades have been seen for that candle yet.
   */
  getBucket(openTimeMs: number): CandelDeltaBucket | null {
    return this._buckets.get(openTimeMs) ?? null;
  }

  /**
   * Get all accumulated buckets, sorted ascending by open time.
   * Used to seed the CVD indicator on mount.
   */
  getAllBuckets(): CandelDeltaBucket[] {
    return [...this._buckets.values()].sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * Remove buckets older than `keepMs` milliseconds from now.
   * Call periodically (e.g. every hour) to prevent unbounded memory growth
   * on long-running sessions.
   */
  pruneOlderThan(keepMs: number): void {
    const cutoff = Date.now() - keepMs;
    for (const [openTime] of this._buckets) {
      if (openTime < cutoff) this._buckets.delete(openTime);
    }
  }

  /** Total number of candle buckets currently in memory. */
  get size(): number { return this._buckets.size; }
}

/**
 * Module-level accumulator registry — one per (symbol, timeframe).
 * Managed by useDeltaAccumulator hook; exported for the hook's use only.
 */
const _registry = new Map<string, DeltaAccumulator>();

function accKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}

export function getOrCreateAccumulator(symbol: string, timeframe: Timeframe): DeltaAccumulator {
  const key = accKey(symbol, timeframe);
  const existing = _registry.get(key);
  if (existing) return existing;
  const acc = new DeltaAccumulator(timeframe);
  _registry.set(key, acc);
  return acc;
}

export function removeAccumulator(symbol: string, timeframe: Timeframe): void {
  _registry.delete(accKey(symbol, timeframe));
}
