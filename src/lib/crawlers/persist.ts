/**
 * Persist layer for crawled articles.
 *
 * Responsible for:
 *  1. Deduplication via ON CONFLICT (source, external_id) DO NOTHING
 *  2. Symbol entity tagging before insert
 *  3. Source credibility assignment
 *
 * Server-side only.
 */

import { db } from '@/lib/db/client';
import { extractSymbols } from '@/lib/sentiment/entity';
import { SOURCE_CREDIBILITY, type RawArticle } from './types';

export interface PersistResult {
  inserted: number;
  skipped:  number;
}

/**
 * Upsert a batch of raw articles.
 * Returns counts of newly inserted vs. already-known articles.
 */
export async function upsertArticles(articles: RawArticle[]): Promise<PersistResult> {
  if (articles.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;

  for (const article of articles) {
    const symbols     = extractSymbols(`${article.title} ${article.body ?? ''}`);
    const credibility = SOURCE_CREDIBILITY[article.source] ?? 0.5;
    // Truncate body to 500 chars — enough for sentiment, never store full article HTML
    const body        = article.body ? article.body.slice(0, 500) : null;

    const result = await db.query(`
      INSERT INTO news_articles
        (source, external_id, url, title, body, author, published_at, symbols, credibility)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (source, external_id) DO NOTHING
    `, [
      article.source,
      article.externalId,
      article.url,
      article.title,
      body,
      article.author ?? null,
      article.publishedAt,
      symbols,
      credibility,
    ]);

    if ((result.rowCount ?? 0) > 0) inserted++;
  }

  return { inserted, skipped: articles.length - inserted };
}
