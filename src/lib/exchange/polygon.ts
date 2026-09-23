import type { Candle, Timeframe } from '@/types/market';
import { TF_TO_MS } from './binance';

interface PolygonBar {
  t: number;   // Timestamp ms
  o: number;   // Open
  h: number;   // High
  l: number;   // Low
  c: number;   // Close
  v: number;   // Volume
  vw?: number; // Volume weighted average price
  n?: number;  // Number of transactions
}

interface PolygonAggsResponse {
  ticker?: string;
  queryCount?: number;
  resultsCount?: number;
  adjusted?: boolean;
  results?: PolygonBar[];
  status?: string;
  error?: string;
  message?: string;
}

interface PolygonSnapshotResponse {
  status?: string;
  ticker?: {
    ticker?: string;
    todaysChange?: number;
    todaysChangePerc?: number;
    updated?: number;
    day?: {
      c?: number;
      h?: number;
      l?: number;
      o?: number;
      v?: number;
    };
    min?: {
      c?: number;
    };
    prevDay?: {
      c?: number;
      h?: number;
      l?: number;
      o?: number;
      v?: number;
    };
  };
}

/** Map RMC Timeframe to Polygon multiplier and timespan */
export function toPolygonParams(tf: Timeframe): { multiplier: number; timespan: string; lookbackMs: number } {
  switch (tf) {
    case '1m':  return { multiplier: 1,  timespan: 'minute', lookbackMs: 2 * 86_400_000 };
    case '3m':  return { multiplier: 3,  timespan: 'minute', lookbackMs: 5 * 86_400_000 };
    case '5m':  return { multiplier: 5,  timespan: 'minute', lookbackMs: 10 * 86_400_000 };
    case '15m': return { multiplier: 15, timespan: 'minute', lookbackMs: 30 * 86_400_000 };
    case '30m': return { multiplier: 30, timespan: 'minute', lookbackMs: 60 * 86_400_000 };
    case '1h':  return { multiplier: 1,  timespan: 'hour',   lookbackMs: 365 * 86_400_000 };
    case '2h':  return { multiplier: 2,  timespan: 'hour',   lookbackMs: 730 * 86_400_000 };
    case '4h':  return { multiplier: 4,  timespan: 'hour',   lookbackMs: 730 * 86_400_000 };
    case '6h':  return { multiplier: 6,  timespan: 'hour',   lookbackMs: 730 * 86_400_000 };
    case '12h': return { multiplier: 12, timespan: 'hour',   lookbackMs: 730 * 86_400_000 };
    case '1d':  return { multiplier: 1,  timespan: 'day',    lookbackMs: 5 * 365 * 86_400_000 };
    case '1w':  return { multiplier: 1,  timespan: 'week',   lookbackMs: 10 * 365 * 86_400_000 };
    default:    return { multiplier: 1,  timespan: 'day',    lookbackMs: 365 * 86_400_000 };
  }
}

/**
 * Fetch historical candles for a US equity from Polygon.io.
 * Requires POLYGON_API_KEY environment variable.
 */
export async function fetchPolygonCandles(
  symbol: string,
  tf: Timeframe,
  apiKey: string,
  limit: number = 5000,
): Promise<Candle[]> {
  const { multiplier, timespan, lookbackMs } = toPolygonParams(tf);
  const cleanSym = symbol.toUpperCase().trim();
  const to = new Date().toISOString().split('T')[0]!;
  const from = new Date(Date.now() - lookbackMs).toISOString().split('T')[0]!;

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(cleanSym)}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}&apiKey=${apiKey}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Polygon aggs returned HTTP ${res.status}: ${errorText}`);
  }

  const json = (await res.json()) as PolygonAggsResponse;
  if (!json.results || json.results.length === 0) {
    return [];
  }

  const barIntervalMs = TF_TO_MS[tf] || 86_400_000;
  const candles: Candle[] = [];

  for (let i = 0; i < json.results.length; i++) {
    const bar = json.results[i]!;
    const openTime = bar.t;
    const nextBar = json.results[i + 1];
    const closeTime = nextBar ? nextBar.t - 1 : openTime + barIntervalMs - 1;

    candles.push({
      openTime,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      // Quote-asset volume, matching Candle.volume's project-wide definition.
      // vwap is the truer average trade price when Polygon supplies it.
      volume: Number((bar.v * (bar.vw ?? bar.c)).toFixed(2)),
      closeTime,
    });
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  return candles;
}

/**
 * Fetch latest quote for a US equity from Polygon.io snapshot.
 */
export async function fetchPolygonQuote(
  symbol: string,
  apiKey: string,
): Promise<{ price: number; changePct: number } | null> {
  const cleanSym = symbol.toUpperCase().trim();
  const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(cleanSym)}?apiKey=${apiKey}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    });

    if (!res.ok) return null;

    const json = (await res.json()) as PolygonSnapshotResponse;
    const ticker = json.ticker;
    if (!ticker) return null;

    // `??` only short-circuits null/undefined, but Polygon reports a literal 0
    // for min.c and day.c before the session's first trade — so pre-market the
    // chain resolved to 0, the caller cached {price: 0} for 30s and never fell
    // back to Yahoo. Take the first value that is actually a traded price.
    const price = [ticker.min?.c, ticker.day?.c, ticker.prevDay?.c]
      .find((v): v is number => typeof v === 'number' && v > 0);
    if (price === undefined) return null;

    const changePct = ticker.todaysChangePerc ?? 0;
    return { price, changePct };
  } catch (err) {
    console.warn(`[polygon] Failed to fetch quote for ${cleanSym}:`, err);
    return null;
  }
}
