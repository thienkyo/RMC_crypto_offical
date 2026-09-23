import type { Candle, Timeframe } from '@/types/market';
import { fetchPolygonCandles, fetchPolygonQuote } from './polygon';
import { fetchYahooCandles, fetchYahooQuote } from './yahoo';

/** Locked Mag7 Basket per docs/equities-plan.md */
export const MAG7_SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
] as const;

/** AI / AI-infra starters per docs/equities-plan.md */
export const AI_BASKET_SYMBOLS = [
  'NVDA', 'AVGO', 'AMD', 'TSM', 'ASML', 'MU', 'WDC', 'STX', 'SMCI', 'ARM', 'PLTR',
] as const;

/** Computer hardware, chips, storage, and infrastructure additions */
export const HARDWARE_SYMBOLS = [
  'INTC', 'DELL', 'QCOM', 'MRVL', 'AMAT', 'LRCX', 'KLAC', 'VRT', 'ANET', 'PSTG', 'HPE',
] as const;

/** Expanded AI & Hardware basket */
export const AI_HARDWARE_SYMBOLS = [
  ...AI_BASKET_SYMBOLS,
  ...HARDWARE_SYMBOLS,
] as const;

/** Combined set of known first-class equities */
export const KNOWN_EQUITIES = new Set<string>([
  ...MAG7_SYMBOLS,
  ...AI_HARDWARE_SYMBOLS,
]);

/** Crypto bases and quote suffixes that must never be treated as US equities */
export const CRYPTO_BASES = new Set<string>([
  'BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'XRP', 'ADA', 'TRX', 'AVAX',
  'LINK', 'DOT', 'MATIC', 'LTC', 'BCH', 'UNI', 'ATOM', 'ETC', 'XLM',
  'NEAR', 'PAXG', 'PEPE', 'SHIB', 'SUI', 'APT', 'RENDER', 'FET',
  'TAO', 'INJ', 'TIA', 'SEI', 'KAS', 'FIL', 'ICP', 'AAVE', 'MKR',
]);

const CRYPTO_QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'TUSD'];

/** Valid US equity ticker format (1-5 uppercase letters with optional .A or .B) */
const EQUITY_TICKER_REGEX = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

/** Check if a symbol is recognized as a US equity */
export function isEquitySymbol(symbol: string): boolean {
  const s = symbol.toUpperCase().trim();
  if (KNOWN_EQUITIES.has(s)) return true;
  if (CRYPTO_BASES.has(s)) return false;
  if (CRYPTO_QUOTE_SUFFIXES.some((q) => s.endsWith(q) && s.length > q.length)) return false;
  return EQUITY_TICKER_REGEX.test(s);
}

/**
 * Fetch OHLCV candles for an equity symbol.
 * Uses Polygon if POLYGON_API_KEY is present, otherwise falls back to Yahoo.
 * Also catches Polygon failures (e.g. rate limits) and falls back to Yahoo.
 */
export type EquityProvider = 'polygon' | 'yahoo';

export interface EquityCandles {
  candles: Candle[];
  /**
   * Which provider produced these bars. The caller must persist it: Polygon
   * returns split-adjusted prices and Yahoo raw ones, so bars from the two
   * disagree across a split boundary. Without the provider on the row, a
   * history silently assembled from both cannot be reconciled afterwards.
   */
  provider: EquityProvider;
}

export async function fetchEquityCandles(
  symbol: string,
  tf: Timeframe,
  limit?: number,
): Promise<EquityCandles> {
  const cleanSym = symbol.toUpperCase().trim();
  const polygonKey = process.env.POLYGON_API_KEY;

  if (polygonKey) {
    try {
      const bars = await fetchPolygonCandles(cleanSym, tf, polygonKey, limit);
      if (bars.length > 0) return { candles: bars, provider: 'polygon' };
    } catch (err) {
      console.warn(`[equities] Polygon fetch failed for ${cleanSym}, falling back to Yahoo:`, err);
    }
  }

  return { candles: await fetchYahooCandles(cleanSym, tf, limit), provider: 'yahoo' };
}

// ── Quote Cache (30s TTL) ─────────────────────────────────────────────────────
const quoteCache = new Map<string, { price: number; changePct: number; timestamp: number }>();
const QUOTE_CACHE_TTL = 30_000;

/**
 * Fetch latest price and 24h change % for an equity symbol.
 */
export async function fetchEquityQuote(
  symbol: string,
): Promise<{ price: number; changePct: number } | null> {
  const cleanSym = symbol.toUpperCase().trim();
  const now = Date.now();

  const cached = quoteCache.get(cleanSym);
  if (cached && now - cached.timestamp < QUOTE_CACHE_TTL) {
    return { price: cached.price, changePct: cached.changePct };
  }

  const polygonKey = process.env.POLYGON_API_KEY;

  if (polygonKey) {
    try {
      const quote = await fetchPolygonQuote(cleanSym, polygonKey);
      if (quote) {
        quoteCache.set(cleanSym, { ...quote, timestamp: now });
        return quote;
      }
    } catch (err) {
      console.warn(`[equities] Polygon quote failed for ${cleanSym}, falling back to Yahoo:`, err);
    }
  }

  const quote = await fetchYahooQuote(cleanSym);
  if (quote) {
    quoteCache.set(cleanSym, { ...quote, timestamp: now });
  }
  return quote;
}

/**
 * Fetch quotes for multiple equity symbols with concurrency limit.
 */
export async function fetchEquityQuotes(
  symbols: string[],
): Promise<Record<string, { price: number; changePct: number }>> {
  const results: Record<string, { price: number; changePct: number }> = {};
  const cleanSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase().trim())));

  // Concurrency chunking (2 at a time) to prevent provider throttling
  const chunkSize = 2;
  for (let i = 0; i < cleanSymbols.length; i += chunkSize) {
    const chunk = cleanSymbols.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (sym) => {
        const q = await fetchEquityQuote(sym);
        if (q) results[sym] = q;
      }),
    );
  }

  return results;
}
