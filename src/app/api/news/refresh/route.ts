/**
 * POST/GET /api/news/refresh
 *
 * Manual one-shot trigger for the whole news pipeline — the UI "Refresh" button
 * calls this instead of waiting for cron. Runs every crawler in sequence, then
 * classifies the freshly-inserted articles with Gemini.
 *
 * Unlike the /api/cron/* routes this has NO auth gate — it's a personal,
 * single-user, localhost tool. Don't expose it publicly without adding one.
 *
 * Returns a combined summary so the client can show "+N articles, M classified".
 */

import { buildRssCrawlers } from '@/lib/crawlers/rss';
import { buildRedditCrawlers } from '@/lib/crawlers/reddit';
import { buildNitterCrawlers } from '@/lib/crawlers/nitter';
import { crawlPolymarket } from '@/lib/crawlers/polymarket';
import { upsertArticles } from '@/lib/crawlers/persist';
import type { Crawler } from '@/lib/crawlers/types';
import { getUnclassifiedArticles, updateArticleSentiment } from '@/lib/db/news';
import { classifyBatch } from '@/lib/sentiment/classify';
import { summarizeArticle } from '@/lib/sentiment/summarize';

export const maxDuration = 60; // generous — this fans out to several external feeds

const HIGH_SIGNAL_THRESHOLD = 0.65;
const GEMINI_MODEL_NAME     = 'gemini-2.0-flash-lite';
const MAX_SENTIMENT_BATCHES = 4; // up to 200 articles per refresh — bounds runtime

interface RefreshSummary {
  ok:            boolean;
  totalInserted: number;
  bySource:      Record<string, number>;
  classified:    number;
  summarized:    number;
  sentimentError?: string;
}

/** Run one crawler and fold its insert count into the summary. Never throws. */
async function runCrawler(label: string, crawler: Crawler, bySource: Record<string, number>): Promise<number> {
  try {
    const articles = await crawler.fetch();
    const { inserted } = await upsertArticles(articles);
    bySource[label] = (bySource[label] ?? 0) + inserted;
    return inserted;
  } catch (err) {
    console.error(`[refresh:${label}] error:`, (err as Error).message);
    bySource[label] = bySource[label] ?? 0;
    return 0;
  }
}

async function runRefresh(): Promise<RefreshSummary> {
  const bySource: Record<string, number> = {};
  let totalInserted = 0;

  // ── 1. Crawl every source ──────────────────────────────────────────────────
  for (const c of buildRssCrawlers()) {
    totalInserted += await runCrawler(c.name, c, bySource);
  }

  if (process.env['REDDIT_CLIENT_ID']) {
    for (const c of buildRedditCrawlers()) {
      totalInserted += await runCrawler(`reddit:${c.subreddit}`, c, bySource);
    }
  }

  for (const c of await buildNitterCrawlers()) {
    totalInserted += await runCrawler(`nitter:${c.name}`, c, bySource);
  }

  try {
    const { inserted } = await crawlPolymarket();
    bySource['polymarket'] = inserted;
  } catch (err) {
    console.error('[refresh:polymarket] error:', (err as Error).message);
  }

  // ── 2. Classify freshly-inserted (and any backlog) articles ─────────────────
  let classified = 0;
  let summarized = 0;
  let sentimentError: string | undefined;

  try {
    for (let batch = 0; batch < MAX_SENTIMENT_BATCHES; batch++) {
      const articles = await getUnclassifiedArticles(50);
      if (articles.length === 0) break;

      const sentimentMap = await classifyBatch(articles);

      for (const article of articles) {
        const result = sentimentMap.get(article.id);
        if (!result) continue;

        let summary: string | null = null;
        if (Math.abs(result.score) >= HIGH_SIGNAL_THRESHOLD) {
          summary = await summarizeArticle(article.title, article.body);
          if (summary) summarized++;
        }

        await updateArticleSentiment(article.id, result.score, result.label, GEMINI_MODEL_NAME, summary ?? undefined);
        classified++;
      }
    }
  } catch (err) {
    // Crawl already succeeded — report the sentiment failure without 500-ing.
    sentimentError = (err as Error).message;
    console.error('[refresh:sentiment] error:', sentimentError);
  }

  console.log(`[news:refresh] +${totalInserted} articles, classified=${classified}, summarized=${summarized}`);
  return { ok: true, totalInserted, bySource, classified, summarized, sentimentError };
}

export async function POST(): Promise<Response> {
  return Response.json(await runRefresh());
}

// Allow triggering from the browser address bar / a plain link too.
export const GET = POST;
