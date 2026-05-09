import type { Candle, Timeframe } from '@/types/market';
import type { RawBinanceKlineRow, BinanceKlineStreamMsg, BinanceMiniTickerMsg } from './types';

const REST_BASE = 'https://api.binance.com';
const WS_BASE   = 'wss://stream.binance.com:9443/ws';

/** Map internal timeframe keys → Binance interval strings. */
export const TF_TO_BINANCE: Record<Timeframe, string> = {
  '1m':  '1m',  '3m':  '3m',  '5m':  '5m',
  '15m': '15m', '30m': '30m',
  '1h':  '1h',  '2h':  '2h',  '4h':  '4h',
  '6h':  '6h',  '12h': '12h',
  '1d':  '1d',  '1w':  '1w',
};

/** Approximate milliseconds per bar for pagination math. */
export const TF_TO_MS: Record<Timeframe, number> = {
  '1m':   60_000,         '3m':   180_000,      '5m':   300_000,
  '15m':  900_000,        '30m':  1_800_000,
  '1h':   3_600_000,      '2h':   7_200_000,    '4h':   14_400_000,
  '6h':   21_600_000,     '12h':  43_200_000,
  '1d':   86_400_000,     '1w':   604_800_000,
};

// ─── REST ─────────────────────────────────────────────────────────────────────

function rowToCandle(row: RawBinanceKlineRow): Candle {
  return {
    openTime:  row[0],
    open:      parseFloat(row[1]),
    high:      parseFloat(row[2]),
    low:       parseFloat(row[3]),
    close:     parseFloat(row[4]),
    // Use quote asset volume (row[7]) — more useful than base volume for USD-denominated analysis
    volume:    parseFloat(row[7]),
    closeTime: row[6],
  };
}

/**
 * Fetch up to 1000 OHLCV candles from Binance REST (no API key required).
 *
 * @param symbol   Exchange symbol, e.g. "BTCUSDT"
 * @param tf       Internal timeframe key
 * @param limit    Max bars to return (Binance cap: 1000)
 * @param startMs  Optional start timestamp (unix ms); fetches forward from here
 * @param noCache  When true, bypasses the Next.js 60s fetch cache — use for live tail refreshes
 */
export async function fetchKlines(
  symbol: string,
  tf: Timeframe,
  limit = 500,
  startMs?: number,
  noCache = false,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval: TF_TO_BINANCE[tf],
    limit:    String(Math.min(limit, 1000)),
  });
  if (startMs !== undefined) params.set('startTime', String(startMs));

  const url = `${REST_BASE}/api/v3/klines?${params.toString()}`;

  const res = await fetch(url, {
    // noCache=true → bypass fetch cache so tail refreshes always get live bars
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 60 } }),
    headers: { 'Accept': 'application/json' },
  });

  if (res.status === 429 || res.status === 418) {
    // Rate limited — surface clearly
    throw new Error(`Binance rate-limited (${res.status}). Back off and retry.`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance REST ${res.status}: ${body.slice(0, 200)}`);
  }

  const rows = (await res.json()) as RawBinanceKlineRow[];
  return rows.map(rowToCandle);
}

/**
 * Backfill N candles by paginating Binance REST in reverse-time order.
 * Uses a 300ms pause between pages to stay well within rate limits.
 *
 * Returns candles sorted oldest → newest.
 */
export async function backfillKlines(
  symbol: string,
  tf: Timeframe,
  totalCandles: number,
): Promise<Candle[]> {
  const pageSize  = 1000;
  const pages     = Math.ceil(totalCandles / pageSize);
  const barMs     = TF_TO_MS[tf];
  const now       = Date.now();
  const all: Candle[] = [];

  for (let i = pages - 1; i >= 0; i--) {
    // Work backwards: page 0 = most recent, page N-1 = oldest
    const startMs = now - (i + 1) * pageSize * barMs;
    const candles = await fetchKlines(symbol, tf, pageSize, startMs);
    all.push(...candles);
    if (i > 0) await sleep(300);
  }

  // Deduplicate and sort
  const seen = new Set<number>();
  return all
    .filter((c) => {
      if (seen.has(c.openTime)) return false;
      seen.add(c.openTime);
      return true;
    })
    .sort((a, b) => a.openTime - b.openTime);
}

// ─── WebSocket (client-side only) ─────────────────────────────────────────────

/**
 * Subscribe to Binance kline stream in the browser.
 * The browser connects directly to Binance WS — no server proxy needed for public data.
 *
 * @param symbol    e.g. "BTCUSDT"
 * @param tf        Internal timeframe key
 * @param onCandle  Called on every tick; `isClosed` is true when the bar is complete
 * @param onError   Called on WS error
 * @returns Cleanup function — call it on component unmount
 */
export function subscribeKline(
  symbol: string,
  tf: Timeframe,
  onCandle: (candle: Candle, isClosed: boolean) => void,
  onError?: () => void,
): () => void {
  const stream = `${symbol.toLowerCase()}@kline_${TF_TO_BINANCE[tf]}`;
  let ws: WebSocket;
  let intentionallyClosed = false;

  function connect() {
    ws = new WebSocket(`${WS_BASE}/${stream}`);

    ws.onmessage = (event) => {
      // Guard: the browser may deliver buffered messages after ws.close() is called.
      // intentionallyClosed is set synchronously in the cleanup function, so any
      // message arriving after that belongs to the previous symbol/timeframe and
      // must be dropped to prevent stale-tick errors in the chart.
      if (intentionallyClosed) return;

      const msg = JSON.parse(event.data as string) as BinanceKlineStreamMsg;
      const k = msg.k;
      onCandle(
        {
          openTime:  k.t,
          open:      parseFloat(k.o),
          high:      parseFloat(k.h),
          low:       parseFloat(k.l),
          close:     parseFloat(k.c),
          volume:    parseFloat(k.q), // quote asset volume
          closeTime: k.T,
        },
        k.x, // isClosed
      );
    };

    ws.onerror = () => {
      onError?.();
    };

    ws.onclose = () => {
      if (!intentionallyClosed) {
        // Auto-reconnect after 2s on unexpected close
        setTimeout(connect, 2_000);
      }
    };
  }

  connect();

  return () => {
    intentionallyClosed = true;
    ws?.close();
  };
}

/**
 * Subscribe to the 24hr mini-ticker stream for one symbol.
 * Used by the watchlist for live price/change updates.
 */
export function subscribeTicker(
  symbol: string,
  onTick: (price: number, changePct: number) => void,
): () => void {
  const stream = `${symbol.toLowerCase()}@miniTicker`;
  let ws: WebSocket;
  let intentionallyClosed = false;

  function connect() {
    ws = new WebSocket(`${WS_BASE}/${stream}`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as BinanceMiniTickerMsg;
      const price     = parseFloat(msg.c);
      const open      = parseFloat(msg.o);
      const changePct = open !== 0 ? ((price - open) / open) * 100 : 0;
      onTick(price, changePct);
    };

    ws.onclose = () => {
      if (!intentionallyClosed) setTimeout(connect, 2_000);
    };
  }

  connect();
  return () => { intentionallyClosed = true; ws?.close(); };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
