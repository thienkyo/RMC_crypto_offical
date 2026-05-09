/**
 * POST /api/cron/crawl-reddit
 *
 * Crawls r/cryptocurrency, r/bitcoin, r/ethtrader, r/CryptoMarkets.
 * Runs every 30 min via Vercel cron.
 *
 * Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in .env.local.
 */

import { NextRequest } from 'next/server';
import { buildRedditCrawlers } from '@/lib/crawlers/reddit';
import { upsertArticles } from '@/lib/crawlers/persist';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  if (!process.env['REDDIT_CLIENT_ID']) {
    return Response.json({ ok: false, message: 'REDDIT_CLIENT_ID not set — skipping' });
  }

  const crawlers = buildRedditCrawlers();
  let totalInserted = 0;
  const results: Record<string, { inserted: number; skipped: number }> = {};

  for (const crawler of crawlers) {
    try {
      const articles = await crawler.fetch();
      const result   = await upsertArticles(articles);
      // Reddit crawler.name is always 'reddit'; use subreddit for logging
      const key = `reddit:${crawler.subreddit}`;
      results[key] = result;
      totalInserted += result.inserted;
      console.log(`[cron:${key}] +${result.inserted} new`);
    } catch (err) {
      console.error(`[cron:reddit] error:`, (err as Error).message);
    }
  }

  return Response.json({ ok: true, totalInserted, results });
}
