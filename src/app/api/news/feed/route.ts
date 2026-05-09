/**
 * GET /api/news/feed
 *
 * Returns recent articles for a symbol plus an aggregate sentiment object.
 *
 * Query params:
 *   symbol  (required) — e.g. BTCUSDT
 *   limit   (optional) — default 50, max 200
 *   since   (optional) — ISO 8601; paginate by fetching articles before this timestamp
 *   source  (optional) — filter to a specific source (e.g. "reddit")
 *   window  (optional) — "1h" | "24h" for aggregate; default "24h"
 */

import { NextRequest } from 'next/server';
import { getArticlesForSymbol, getAggregateSentiment } from '@/lib/db/news';
import type { NewsFeedResponse } from '@/types/news';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;

  const symbol = searchParams.get('symbol')?.toUpperCase();
  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
  const before = searchParams.get('since') ?? undefined;
  const source = searchParams.get('source') ?? undefined;
  const window = (searchParams.get('window') ?? '24h') === '1h' ? 1 : 24;

  const [articles, aggregate] = await Promise.all([
    getArticlesForSymbol(symbol, limit, before, source),
    getAggregateSentiment(symbol, window as 1 | 24),
  ]);

  const body: NewsFeedResponse = { articles, aggregate };
  return Response.json(body, {
    headers: {
      // Allow TanStack Query to use stale data for up to 60s
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
