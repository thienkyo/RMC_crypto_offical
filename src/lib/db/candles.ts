import { db } from '@/lib/db/client';
import { fetchKlines, TF_TO_MS } from '@/lib/exchange/binance';
import { fetchEquityCandles, isEquitySymbol } from '@/lib/exchange/equities';
import type { Candle, Timeframe } from '@/types/market';

// Cache structure: maps "symbol:timeframe:limit" to candles and time of fetch
interface CacheEntry {
  candles: Candle[];
  timestamp: number;
}

const candlesCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<Candle[]>>();
const CACHE_TTL_MS = 10_000; // 10 seconds cache TTL

/**
 * Shared, cached, and deduplicated candle fetcher.
 * Deduplicates concurrent fetches for the same symbol + timeframe + limit by returning the same promise.
 * Caches resolved results for 10 seconds to satisfy consecutive requests within the same tick.
 */
export function fetchLatestCandlesCached(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<Candle[]> {
  const cacheKey = `${symbol}:${timeframe}:${limit}`;
  const now = Date.now();

  // 1. Check resolved cache
  const cached = candlesCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return Promise.resolve(cached.candles);
  }

  // 2. Check if a fetch is already in progress for this key
  let pending = pendingRequests.get(cacheKey);
  if (!pending) {
    pending = fetchLatestCandlesUncached(symbol, timeframe, limit)
      .then((result) => {
        candlesCache.set(cacheKey, { candles: result, timestamp: Date.now() });
        pendingRequests.delete(cacheKey);
        return result;
      })
      .catch((err) => {
        pendingRequests.delete(cacheKey);
        throw err;
      });
    pendingRequests.set(cacheKey, pending);
  }

  return pending;
}

async function fetchLatestCandlesUncached(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<Candle[]> {
  // ── 1. DB fetch (history / warm-up window) ───────────────────────────────
  const { rows } = await db.query<{
    open_time: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
    close_time: Date;
  }>(
    `SELECT open_time, open, high, low, close, volume, close_time
     FROM candles
     WHERE symbol = $1 AND timeframe = $2 AND source = $4
     ORDER BY open_time DESC
     LIMIT $3`,
    [symbol, timeframe, limit, isEquitySymbol(symbol) ? 'equities' : 'binance'],
  );

  const dbCandles: Candle[] = rows.reverse().map((r) => ({
    openTime: r.open_time.getTime(),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseFloat(r.volume),
    closeTime: r.close_time.getTime(),
  }));

  // ── 2. Fresh tail fetch (equities vs crypto) ────────────────────────────
  try {
    if (isEquitySymbol(symbol)) {
      const { candles: freshEquity } = await fetchEquityCandles(symbol, timeframe as Timeframe, limit);
      if (freshEquity.length === 0) return dbCandles;

      // Merge rather than return the provider result outright. Backtests and
      // long-lookback indicators (a 200-period EMA, say) call this for far more
      // history than one provider response carries, and returning only the fresh
      // window silently shortened the series — so results moved run to run.
      const cutoff = freshEquity[0]!.openTime;
      return [...dbCandles.filter((c) => c.openTime < cutoff), ...freshEquity].slice(-limit);
    }

    const dbTailTime = dbCandles.length > 0 ? dbCandles[dbCandles.length - 1]!.openTime : 0;
    const tfMs = TF_TO_MS[timeframe as Timeframe];
    const missingCandles = dbTailTime > 0 ? Math.ceil((Date.now() - dbTailTime) / tfMs) + 5 : limit;
    const fetchLimit = Math.min(limit, Math.max(5, missingCandles));

    const freshTail = await fetchKlines(
      symbol,
      timeframe as Timeframe,
      fetchLimit,
      undefined,
      true, // noCache — bypass exchange caching to ensure fresh tail
    );

    if (freshTail.length === 0) return dbCandles;

    const freshStart = freshTail[0]!.openTime;
    const base = dbCandles.filter((c) => c.openTime < freshStart);
    const merged = [...base, ...freshTail];

    console.log(
      `[candles/cache] ${symbol}/${timeframe}: ` +
      `DB tail=${new Date(dbCandles[dbCandles.length - 1]?.openTime ?? 0).toISOString()}, ` +
      `Binance tail=${new Date(freshTail[freshTail.length - 1]!.openTime).toISOString()}, ` +
      `merged=${merged.length} candles (fetched uncached)`
    );

    return merged;
  } catch (err) {
    console.warn(`[candles/cache] Binance tail fetch failed for ${symbol}/${timeframe}:`, err);
    return dbCandles;
  }
}
