/**
 * POST /api/cron/crawl-telegram
 *
 * Crawls tracked public Telegram web previews (t.me/s/*) and persists new articles.
 * Runs every 15 min via Vercel cron (see vercel.json).
 */

import { NextRequest } from 'next/server';
import { TelegramCrawler } from '@/lib/crawlers/telegram';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30; // seconds — Vercel hobby limit

export const GET = POST;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  try {
    const crawler = new TelegramCrawler();
    const result = await crawler.run();
    console.log(`[cron:telegram] +${result.inserted} new, ${result.skipped} dupe`);
    return Response.json({ ok: true, source: 'telegram', ...result });
  } catch (err) {
    console.error('[cron:telegram] error:', (err as Error).message);
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
