/**
 * POST /api/cron/crawl-nitter
 *
 * Fetches RSS feeds for all active Nitter accounts stored in the DB.
 * Runs every 20 min via Vercel cron.
 */

import { NextRequest } from 'next/server';
import { buildNitterCrawlers } from '@/lib/crawlers/nitter';
import { upsertArticles } from '@/lib/crawlers/persist';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const crawlers = await buildNitterCrawlers();
  if (crawlers.length === 0) {
    return Response.json({ ok: true, message: 'No active Nitter accounts', totalInserted: 0 });
  }

  let totalInserted = 0;

  for (const crawler of crawlers) {
    try {
      const articles = await crawler.fetch();
      const result   = await upsertArticles(articles);
      totalInserted += result.inserted;
      console.log(`[cron:nitter:@${crawler.name}] +${result.inserted} new`);
    } catch (err) {
      console.error(`[cron:nitter] error:`, (err as Error).message);
    }
  }

  return Response.json({ ok: true, totalInserted });
}
