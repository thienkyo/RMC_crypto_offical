/**
 * GET /api/news/digest
 *
 * Returns a Claude-generated "what changed in the last hour" paragraph for a symbol.
 * Cached for 30 min in-process (module-level Map in digest.ts).
 *
 * Query params:
 *   symbol  (required)
 *   window  (optional) — hours to look back; default 1
 */

import { NextRequest } from 'next/server';
import { getRecentArticlesForDigest } from '@/lib/db/news';
import { generateDigest } from '@/lib/sentiment/digest';
import type { NewsDigestResponse } from '@/types/news';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl;

  const symbol = searchParams.get('symbol')?.toUpperCase();
  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  const hours = parseInt(searchParams.get('window') ?? '1', 10);

  const articles = await getRecentArticlesForDigest(symbol, hours);
  const result   = await generateDigest(symbol, articles);

  const body: NewsDigestResponse = {
    digest:       result.digest,
    articleCount: articles.length,
    generatedAt:  result.generatedAt,
    fromCache:    result.fromCache,
  };

  return Response.json(body);
}
