/**
 * POST /api/cron/sentiment-run
 *
 * Picks up to 50 unclassified articles, classifies them with Gemini (one API
 * call for the whole batch), then requests a Claude 1-sentence summary for
 * high-signal articles (|score| >= 0.65).
 *
 * Runs every 5 min via Vercel cron.
 */

import { NextRequest } from 'next/server';
import {
  getUnclassifiedArticles,
  updateArticleSentiment,
} from '@/lib/db/news';
import { classifyBatch } from '@/lib/sentiment/classify';
import { summarizeArticle } from '@/lib/sentiment/summarize';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 45;

const HIGH_SIGNAL_THRESHOLD = 0.65;
const GEMINI_MODEL_NAME     = 'gemini-2.0-flash-lite';

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const articles = await getUnclassifiedArticles(50);
  if (articles.length === 0) {
    return Response.json({ ok: true, classified: 0, message: 'Nothing to classify' });
  }

  let classified    = 0;
  let summarized    = 0;

  // One Gemini call for the entire batch
  let sentimentMap: Map<string, { score: number; label: 'bearish' | 'neutral' | 'bullish' }>;
  try {
    sentimentMap = await classifyBatch(articles);
  } catch (err) {
    console.error('[sentiment-run] Gemini classify failed:', (err as Error).message);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  // Persist results; fetch Claude summaries for high-signal articles
  for (const article of articles) {
    const result = sentimentMap.get(article.id);
    if (!result) continue;

    let summary: string | null = null;

    // Only invoke Claude for strong signals — keeps credit usage minimal
    if (Math.abs(result.score) >= HIGH_SIGNAL_THRESHOLD) {
      try {
        summary = await summarizeArticle(article.title, article.body);
        if (summary) summarized++;
      } catch (err) {
        console.error(`[sentiment-run] summarize failed for ${article.id}:`, (err as Error).message);
      }
    }

    await updateArticleSentiment(
      article.id,
      result.score,
      result.label,
      GEMINI_MODEL_NAME,
      summary ?? undefined,
    );

    classified++;
  }

  console.log(`[cron:sentiment-run] classified=${classified} summarized=${summarized}`);
  return Response.json({ ok: true, classified, summarized });
}
