/**
 * POST /api/cron/crawl-technews
 *
 * Crawls tech news from Hacker News Firebase API and TechCrunch RSS.
 * Runs every 30 min via Vercel cron (see vercel.json).
 */

import { NextRequest } from 'next/server';
import { TechNewsCrawler } from '@/lib/crawlers/technews';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30; // seconds — Vercel hobby limit

export const GET = POST;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  try {
    const crawler = new TechNewsCrawler();
    const result = await crawler.run();
    console.log(`[cron:technews] +${result.inserted} new, ${result.skipped} dupe`);
    return Response.json({ ok: true, source: 'technews', ...result });
  } catch (err) {
    console.error('[cron:technews] error:', (err as Error).message);
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
