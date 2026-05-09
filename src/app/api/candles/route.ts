import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { backfillKlines, fetchKlines, TF_TO_MS } from '@/lib/exchange/binance';
import { TIMEFRAMES } from '@/types/market';
import type { Timeframe } from '@/types/market';

/**
 * How many candles to backfill from Binance on first visit per timeframe.
 * Trades off initial load time (one-time, stored in DB) vs. history depth.
 *
 * Binance paginates at 1000 bars per request with a 300ms gap between pages.
 * Rough cost: ceil(desired / 1000) × 300ms.
 *
 *   1h  → 8,760 bars  ≈ 1 year   → ~9 pages  → ~2.7s first load
 *   4h  → 4,380 bars  ≈ 2 years  → ~5 pages  → ~1.5s
 *   1d  → 1,825 bars  ≈ 5 years  → ~2 pages  → ~0.6s
 *   1w  →   520 bars  ≈ 10 years → 1 page    → instant
 */
const BACKFILL_DEPTH: Record<Timeframe, number> = {
  '1m':  2_880,   // ~2 days   (1m data is huge; 2d is plenty for short-term)
  '3m':  4_800,   // ~10 days
  '5m':  8_640,   // ~30 days
  '15m': 5_760,   // ~60 days
  '30m': 4_320,   // ~90 days
  '1h':  8_760,   // ~1 year
  '2h':  8_760,   // ~2 years
  '4h':  4_380,   // ~2 years
  '6h':  2_920,   // ~2 years
  '12h': 1_460,   // ~2 years
  '1d':  1_825,   // ~5 years
  '1w':    520,   // ~10 years
};

/** Serve at most this many bars to the client per timeframe. */
const SERVE_LIMIT: Record<Timeframe, number> = {
  '1m':  1_440,   // 1 day
  '3m':  2_880,
  '5m':  4_320,
  '15m': 3_840,
  '30m': 3_000,
  '1h':  8_760,
  '2h':  8_760,
  '4h':  4_380,
  '6h':  2_920,
  '12h': 1_460,
  '1d':  1_825,
  '1w':    520,
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = (searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase().trim();
  const tf     = (searchParams.get('interval') ?? '1h') as Timeframe;

  if (!(TIMEFRAMES as readonly string[]).includes(tf)) {
    return NextResponse.json(
      { error: `Invalid interval "${tf}". Valid: ${TIMEFRAMES.join(', ')}` },
      { status: 400 },
    );
  }

  // Client can request a specific limit but we cap it at SERVE_LIMIT[tf]
  const requestedLimit = parseInt(searchParams.get('limit') ?? '0', 10);
  const limit = requestedLimit > 0
    ? Math.min(requestedLimit, SERVE_LIMIT[tf])
    : SERVE_LIMIT[tf];

  const desired = BACKFILL_DEPTH[tf];

  try {
    // ── 1. Check what we have in DB ──────────────────────────────────────────
    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM candles WHERE symbol = $1 AND timeframe = $2`,
      [symbol, tf],
    );
    const dbCount = parseInt(countRows[0]?.count ?? '0', 10);

    // ── 2. Backfill from Binance if DB is thin ───────────────────────────────
    // We consider the DB "complete" if it has ≥ 90% of the desired depth.
    if (dbCount < desired * 0.9) {
      let candles: Awaited<ReturnType<typeof backfillKlines>>;
      try {
        console.log(`[api/candles] Backfilling ${symbol}/${tf}: need ${desired}, have ${dbCount}`);
        candles = await backfillKlines(symbol, tf, desired);
      } catch (err) {
        console.warn(`[api/candles] Backfill failed for ${symbol}/${tf}:`, err);
        candles = [];
      }

      if (candles.length > 0) {
        await db.query(
          `INSERT INTO candles
             (symbol, timeframe, open_time, open, high, low, close, volume, close_time)
           SELECT
             $1, $2,
             to_timestamp(open_ms  / 1000.0),
             o, h, l, c, v,
             to_timestamp(close_ms / 1000.0)
           FROM unnest(
             $3::bigint[],
             $4::numeric[], $5::numeric[], $6::numeric[],
             $7::numeric[], $8::numeric[],
             $9::bigint[]
           ) AS x(open_ms, o, h, l, c, v, close_ms)
           ON CONFLICT (symbol, timeframe, open_time)
           DO UPDATE SET
             open       = EXCLUDED.open,
             high       = EXCLUDED.high,
             low        = EXCLUDED.low,
             close      = EXCLUDED.close,
             volume     = EXCLUDED.volume,
             close_time = EXCLUDED.close_time`,
          [
            symbol, tf,
            candles.map((c) => c.openTime),
            candles.map((c) => c.open),
            candles.map((c) => c.high),
            candles.map((c) => c.low),
            candles.map((c) => c.close),
            candles.map((c) => c.volume),
            candles.map((c) => c.closeTime),
          ],
        );

        await db.query(
          `INSERT INTO backfill_status
             (symbol, timeframe, earliest_time, latest_time, candle_count, updated_at)
           VALUES ($1, $2,
             to_timestamp($3::bigint / 1000.0),
             to_timestamp($4::bigint / 1000.0),
             $5, NOW())
           ON CONFLICT (symbol, timeframe) DO UPDATE
           SET earliest_time = LEAST(backfill_status.earliest_time, EXCLUDED.earliest_time),
               latest_time   = GREATEST(backfill_status.latest_time, EXCLUDED.latest_time),
               candle_count  = EXCLUDED.candle_count,
               updated_at    = NOW()`,
          [
            symbol, tf,
            candles[0]!.openTime,
            candles[candles.length - 1]!.openTime,
            candles.length,
          ],
        );
      }
    }

    // ── 2b. Gap-aware tail refresh from Binance ──────────────────────────────
    // Calculate how many bars are missing since the latest DB entry and fetch
    // exactly that many (capped at 1000).  This fills multi-day gaps that
    // accumulate when the server restarts or the DB falls behind.
    try {
      const { rows: latestRows } = await db.query<{ latest: Date | null }>(
        `SELECT MAX(open_time) AS latest FROM candles WHERE symbol = $1 AND timeframe = $2`,
        [symbol, tf],
      );
      const latestDbMs  = latestRows[0]?.latest?.getTime() ?? 0;
      const periodMs    = TF_TO_MS[tf];
      const gapBars     = latestDbMs > 0 ? Math.ceil((Date.now() - latestDbMs) / periodMs) : 10;
      // Fetch enough bars to cover the gap plus a small overlap buffer (3 bars).
      const tailLimit   = Math.min(Math.max(gapBars + 3, 10), 1000);

      if (gapBars > 10) {
        console.log(`[api/candles] Gap-fill ${symbol}/${tf}: ~${gapBars} bars missing, fetching ${tailLimit}`);
      }

      const tailCandles = await fetchKlines(symbol, tf, tailLimit, undefined, true);
      if (tailCandles.length > 0) {
        await db.query(
          `INSERT INTO candles
             (symbol, timeframe, open_time, open, high, low, close, volume, close_time)
           SELECT
             $1, $2,
             to_timestamp(open_ms  / 1000.0),
             o, h, l, c, v,
             to_timestamp(close_ms / 1000.0)
           FROM unnest(
             $3::bigint[],
             $4::numeric[], $5::numeric[], $6::numeric[],
             $7::numeric[], $8::numeric[],
             $9::bigint[]
           ) AS x(open_ms, o, h, l, c, v, close_ms)
           ON CONFLICT (symbol, timeframe, open_time)
           DO UPDATE SET
             open       = EXCLUDED.open,
             high       = EXCLUDED.high,
             low        = EXCLUDED.low,
             close      = EXCLUDED.close,
             volume     = EXCLUDED.volume,
             close_time = EXCLUDED.close_time`,
          [
            symbol, tf,
            tailCandles.map((c) => c.openTime),
            tailCandles.map((c) => c.open),
            tailCandles.map((c) => c.high),
            tailCandles.map((c) => c.low),
            tailCandles.map((c) => c.close),
            tailCandles.map((c) => c.volume),
            tailCandles.map((c) => c.closeTime),
          ],
        );
      }
    } catch (err) {
      // Non-fatal — we still serve whatever is in the DB.
      // A stale-data banner in the UI will surface if the mismatch persists.
      console.warn(`[api/candles] Tail refresh failed for ${symbol}/${tf}:`, err);
    }

    // ── 3. Serve from DB ─────────────────────────────────────────────────────
    const { rows } = await db.query<{
      open_time:  Date;
      open:       string;
      high:       string;
      low:        string;
      close:      string;
      volume:     string;
      close_time: Date;
    }>(
      `SELECT open_time, open, high, low, close, volume, close_time
       FROM candles
       WHERE symbol = $1 AND timeframe = $2
       ORDER BY open_time DESC
       LIMIT $3`,
      [symbol, tf, limit],
    );

    const data = rows.reverse().map((r) => ({
      openTime:  r.open_time.getTime(),
      open:      parseFloat(r.open),
      high:      parseFloat(r.high),
      low:       parseFloat(r.low),
      close:     parseFloat(r.close),
      volume:    parseFloat(r.volume),
      closeTime: r.close_time.getTime(),
    }));

    return NextResponse.json({ symbol, interval: tf, data });
  } catch (err) {
    console.error('[api/candles] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
