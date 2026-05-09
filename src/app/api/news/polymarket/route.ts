/**
 * GET /api/news/polymarket
 *
 * Returns the latest Polymarket prediction market snapshots for a symbol.
 *
 * Query params:
 *   symbol  (required)
 *   limit   (optional) — default 5
 */

import { NextRequest } from 'next/server';
import { getLatestPolymarketSnaps } from '@/lib/db/news';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;

  const symbol = searchParams.get('symbol')?.toUpperCase();
  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  const limit   = Math.min(parseInt(searchParams.get('limit') ?? '5', 10), 20);
  const markets = await getLatestPolymarketSnaps(symbol, limit);

  return Response.json({ markets }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
