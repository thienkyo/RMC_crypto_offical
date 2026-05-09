/**
 * POST /api/cron/crawl-rss
 *
 * Crawls all configured RSS feeds (CoinDesk, CoinTelegraph, Decrypt, The Block,
 * BeInCrypto) and persists new articles. Runs every 15 min via Vercel cron.
 */

import { NextRequest } from 'next/server';
import { buildRssCrawlers } from '@/lib/crawlers/rss';
import { upsertArticles } from '@/lib/crawlers/persist';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 30; // seconds — Vercel hobby limit

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const crawlers = buildRssCrawlers();
  const results: Record<string, { inserted: number; skipped: number }> = {};
  let totalInserted = 0;

  for (const crawler of crawlers) {
    try {
      const articles = await crawler.fetch();
      const result   = await upsertArticles(articles);
      results[crawler.name] = result;
      totalInserted += result.inserted;
      console.log(`[cron:rss:${crawler.name}] +${result.inserted} new, ${result.skipped} dupe`);
    } catch (err) {
      console.error(`[cron:rss:${crawler.name}] error:`, (err as Error).message);
      results[crawler.name] = { inserted: 0, skipped: 0 };
    }
  }

  return Response.json({ ok: true, totalInserted, results });
}
