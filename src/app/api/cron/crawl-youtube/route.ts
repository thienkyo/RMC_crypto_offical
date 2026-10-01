/**
 * POST /api/cron/crawl-youtube
 *
 * Crawls tracked YouTube channel RSS feeds and persists new videos.
 * Runs every 30 min via Vercel cron (see vercel.json).
 */

import { NextRequest } from 'next/server';
import { YouTubeCrawler } from '@/lib/crawlers/youtube';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30; // seconds — Vercel hobby limit

export const GET = POST;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  try {
    const crawler = new YouTubeCrawler();
    const result = await crawler.run();
    console.log(`[cron:youtube] +${result.inserted} new, ${result.skipped} dupe`);
    return Response.json({ ok: true, source: 'youtube', ...result });
  } catch (err) {
    console.error('[cron:youtube] error:', (err as Error).message);
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
