/**
 * POST /api/cron/crawl-custom
 *
 * Crawls all active custom news feeds and persists new articles.
 * Runs every 15 min via Vercel cron (see vercel.json).
 */

import { NextRequest } from 'next/server';
import { crawlCustomFeeds } from '@/lib/crawlers/custom';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30; // seconds — Vercel hobby limit

// Vercel Cron triggers routes with a GET request, so GET is the entry point.
export const GET = POST;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  try {
    const result = await crawlCustomFeeds();
    console.log(`[cron:custom] Crawled ${result.crawled} feed(s), inserted ${result.inserted} article(s)`);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron:custom] error:', (err as Error).message);
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
