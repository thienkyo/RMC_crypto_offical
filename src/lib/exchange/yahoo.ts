import type { Candle, Timeframe } from '@/types/market';
import { TF_TO_MS } from './binance';

interface YahooChartMeta {
  currency?: string;
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketChangePercent?: number;
  regularMarketTime?: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: YahooChartMeta;
      timestamp?: number[];
      indicators: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    };
  };
}

/** Map RMC Timeframe to Yahoo Chart interval & sensible default range */
export function toYahooParams(tf: Timeframe): { interval: string; range: string } | null {
  switch (tf) {
    case '1m':  return { interval: '1m',  range: '1d'  };
    case '5m':  return { interval: '5m',  range: '5d'  };
    case '15m': return { interval: '15m', range: '1mo' };
    case '30m': return { interval: '30m', range: '1mo' };
    case '1h':  return { interval: '60m', range: '1y'  };
    case '1d':  return { interval: '1d',  range: '5y'  };
    case '1w':  return { interval: '1wk', range: '10y' };
    // 3m / 2h / 4h / 6h / 12h have no Yahoo equivalent. Previously they were
    // aliased onto a neighbouring interval (4h → 60m, 12h → 1d) and the bars
    // were then stored UNDER THE REQUESTED TIMEFRAME — hourly candles labelled
    // 4h, indicators computing over the wrong resolution, and rows a later
    // true-4h fetch could never overwrite because the open_times differ.
    default:    return null;
  }
}

// ── In-Memory Session Cache (Cookie + Crumb) ──────────────────────────────────
interface YahooSession {
  cookie: string;
  crumb: string;
  expiresAt: number;
}

let sessionCache: YahooSession | null = null;
let sessionPromise: Promise<YahooSession | null> | null = null;
/**
 * When the handshake fails, don't retry it for a while.
 *
 * fc.yahoo.com routinely blocks datacenter IPs. Without this, every Yahoo call
 * re-ran two fetches with 3s timeouts each, and fetchEquityQuotes chunks its
 * work sequentially — seven Mag7 symbols cost four chunks × ~6s of handshake
 * alone, longer than the 30s poll interval, so requests piled up and prices
 * never populated.
 */
let sessionFailedUntil = 0;
const SESSION_FAILURE_COOLDOWN = 60_000;

async function getYahooSession(): Promise<YahooSession | null> {
  const now = Date.now();
  if (sessionCache && sessionCache.expiresAt > now) {
    return sessionCache;
  }
  if (now < sessionFailedUntil) return null;

  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    try {
      // 1. Fetch cookie from fc.yahoo.com
      const fcRes = await fetch('https://fc.yahoo.com', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(3000),
      });

      const rawCookie = fcRes.headers.get('set-cookie');
      if (!rawCookie) return null;

      const match = rawCookie.match(/A3=([^;]+)/);
      const cookie = match ? `A3=${match[1]}` : rawCookie.split(';')[0]!;

      // 2. Fetch crumb from query1
      const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!crumbRes.ok) return null;
      const crumb = (await crumbRes.text()).trim();
      if (!crumb || crumb.includes('<html')) return null;

      sessionCache = {
        cookie,
        crumb,
        expiresAt: Date.now() + 3600 * 1000, // 1 hour cache
      };
      return sessionCache;
    } catch {
      // Session handshake optional — chart requests often succeed directly
      return null;
    } finally {
      sessionPromise = null;
      // One place to arm the cooldown, rather than at each of the five null
      // returns above: if we got here without a live session, it failed.
      if (!sessionCache || sessionCache.expiresAt <= Date.now()) {
        sessionFailedUntil = Date.now() + SESSION_FAILURE_COOLDOWN;
      }
    }
  })();

  return sessionPromise;
}

/**
 * Fetch historical candles for a US equity from Yahoo Finance v8 chart API.
 * Free, requires no API key, works out of the box for local development.
 */
export async function fetchYahooCandles(
  symbol: string,
  tf: Timeframe,
  limit?: number,
): Promise<Candle[]> {
  const params = toYahooParams(tf);
  if (!params) {
    // Throwing rather than approximating: equities.ts catches this and the
    // route stores nothing, which is far better than writing bars of the wrong
    // resolution under this timeframe where nothing can later distinguish them.
    throw new Error(`Yahoo has no ${tf} interval; unsupported timeframe for equities`);
  }
  const { interval, range } = params;
  const cleanSym = symbol.toUpperCase().trim();
  const session = await getYahooSession();

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://finance.yahoo.com',
  };
  if (session?.cookie) {
    headers['Cookie'] = session.cookie;
  }

  const crumbParam = session ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=${interval}&range=${range}&includePrePost=false${crumbParam}`;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo chart API returned HTTP ${res.status} for ${cleanSym}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  const result = json.chart.result?.[0];
  if (!result || !result.timestamp || result.timestamp.length === 0) {
    return [];
  }

  const timestamps = result.timestamp;
  const quote = result.indicators.quote?.[0];
  if (!quote) return [];

  const { open, high, low, close, volume } = quote;
  const regularPrice = result.meta.regularMarketPrice;
  const barIntervalMs = TF_TO_MS[tf] || 86_400_000;

  const candles: Candle[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const tsSec = timestamps[i];
    if (tsSec === undefined) continue;

    const o = open?.[i];
    const h = high?.[i];
    const l = low?.[i];
    let c = close?.[i];
    const v = volume?.[i] ?? 0;

    // Skip bars with missing core price points
    if (o === null || o === undefined || Number.isNaN(o)) continue;
    if (h === null || h === undefined || Number.isNaN(h)) continue;
    if (l === null || l === undefined || Number.isNaN(l)) continue;

    // For in-progress bars, close might be null -> use regularMarketPrice or open
    if (c === null || c === undefined || Number.isNaN(c)) {
      c = regularPrice ?? o;
    }

    const openTime = tsSec * 1000;
    const nextTs = timestamps[i + 1];
    const closeTime = nextTs ? nextTs * 1000 - 1 : openTime + barIntervalMs - 1;

    candles.push({
      openTime,
      open: Number(o.toFixed(4)),
      high: Number(h.toFixed(4)),
      low: Number(l.toFixed(4)),
      close: Number(c.toFixed(4)),
      // Candle.volume is QUOTE-asset volume everywhere in this project (see
      // types/market.ts and CLAUDE.md's Gotchas). Yahoo reports a share count,
      // so it is converted to traded currency — otherwise NVDA's ~50M reads
      // against BTCUSDT's ~2e9 USDT and any cross-asset volume work is nonsense.
      volume: Number((v * c).toFixed(2)),
      closeTime,
    });
  }

  candles.sort((a, b) => a.openTime - b.openTime);

  if (limit && limit > 0 && candles.length > limit) {
    return candles.slice(-limit);
  }

  return candles;
}

/**
 * Fetch latest quote (price and 24h change %) for a US equity from Yahoo Finance.
 */
export async function fetchYahooQuote(
  symbol: string,
): Promise<{ price: number; changePct: number } | null> {
  const cleanSym = symbol.toUpperCase().trim();
  const session = await getYahooSession();

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://finance.yahoo.com',
  };
  if (session?.cookie) {
    headers['Cookie'] = session.cookie;
  }

  const crumbParam = session ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1d&range=2d&includePrePost=false${crumbParam}`;

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as YahooChartResponse;
    const meta = json.chart.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;

    const price = meta.regularMarketPrice;
    let changePct = meta.regularMarketChangePercent ?? 0;

    // If changePct is not populated directly, calculate from previous close
    if (changePct === 0 && (meta.previousClose || meta.chartPreviousClose)) {
      const prev = meta.previousClose ?? meta.chartPreviousClose!;
      if (prev > 0) {
        changePct = ((price - prev) / prev) * 100;
      }
    }

    return { price, changePct };
  } catch (err) {
    console.warn(`[yahoo] Failed to fetch quote for ${cleanSym}:`, err);
    return null;
  }
}
