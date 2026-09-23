/**
 * DB query helpers for Phase 4 news tables.
 * All queries are server-side only (import from API routes / server components).
 */

import { db } from './client';
import type {
  NewsArticle,
  NewsFeedAggregate,
  SentimentLabel,
  PolymarketSnapshot,
  NitterAccount,
  CustomNewsFeed,
} from '@/types/news';

// ─── Row mappers ─────────────────────────────────────────────────────────────

function rowToArticle(row: Record<string, unknown>): NewsArticle {
  return {
    id:               row['id'] as string,
    source:           row['source'] as string,
    externalId:       row['external_id'] as string,
    url:              row['url'] as string,
    title:            row['title'] as string,
    body:             (row['body'] as string | null) ?? null,
    author:           (row['author'] as string | null) ?? null,
    publishedAt:      (row['published_at'] as Date).toISOString(),
    fetchedAt:        (row['fetched_at'] as Date).toISOString(),
    symbols:          (row['symbols'] as string[]) ?? [],
    sentimentScore:   (row['sentiment_score'] as number | null) ?? null,
    sentimentLabel:   (row['sentiment_label'] as SentimentLabel | null) ?? null,
    sentimentSummary: (row['sentiment_summary'] as string | null) ?? null,
    sentimentModel:   (row['sentiment_model'] as string | null) ?? null,
    credibility:      row['credibility'] as number,
  };
}

// ─── Feed queries ─────────────────────────────────────────────────────────────

/**
 * Fetch recent articles for a symbol, ordered newest-first.
 * Optionally filter by source and paginate via `before` (ISO timestamp).
 */
export async function getArticlesForSymbol(
  symbol:       string,
  limit:        number = 50,
  before?:      string,
  source?:      string,
  windowHours?: number,
): Promise<NewsArticle[]> {
  const params: unknown[] = [symbol, limit];
  let whereExtra = '';

  if (before) {
    params.push(before);
    whereExtra += ` AND published_at < $${params.length}`;
  }
  if (source) {
    params.push(source);
    whereExtra += ` AND source = $${params.length}`;
  }
  if (windowHours) {
    params.push(windowHours);
    whereExtra += ` AND published_at > NOW() - ($${params.length} || ' hours')::interval`;
  }

  const sql = `
    SELECT * FROM news_articles
    WHERE $1 = ANY(symbols)
    ${whereExtra}
    ORDER BY published_at DESC
    LIMIT $2
  `;

  const { rows } = await db.query(sql, params);
  return rows.map(rowToArticle);
}

/**
 * Aggregate sentiment for a symbol over the last N hours.
 * Returns weighted-average score weighted by source credibility.
 */
export async function getAggregateSentiment(
  symbol:  string,
  hours:   1 | 24,
): Promise<NewsFeedAggregate | null> {
  const sql = `
    SELECT
      SUM(sentiment_score * credibility) / NULLIF(SUM(credibility), 0) AS weighted_score,
      COUNT(*)::int AS article_count
    FROM news_articles
    WHERE $1 = ANY(symbols)
      AND sentiment_score IS NOT NULL
      AND published_at > NOW() - ($2 || ' hours')::interval
  `;

  const { rows } = await db.query(sql, [symbol, hours]);
  const row = rows[0];
  if (!row || row['article_count'] === 0) return null;

  const score: number = parseFloat(row['weighted_score']) || 0;
  const label: SentimentLabel = score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral';

  return {
    score,
    label,
    articleCount: row['article_count'] as number,
    window:       hours === 1 ? '1h' : '24h',
  };
}

/**
 * Fetch unclassified articles (sentiment_score IS NULL), up to `limit`.
 * Used by the sentiment-run cron.
 */
export async function getUnclassifiedArticles(limit: number = 50): Promise<NewsArticle[]> {
  const { rows } = await db.query(`
    SELECT * FROM news_articles
    WHERE sentiment_score IS NULL
    ORDER BY fetched_at ASC
    LIMIT $1
  `, [limit]);
  return rows.map(rowToArticle);
}

/**
 * Update sentiment fields for a batch of articles.
 */
export async function updateArticleSentiment(
  id:      string,
  score:   number,
  label:   SentimentLabel,
  model:   string,
  summary?: string,
): Promise<void> {
  await db.query(`
    UPDATE news_articles
    SET sentiment_score = $2, sentiment_label = $3, sentiment_model = $4, sentiment_summary = $5
    WHERE id = $1
  `, [id, score, label, model, summary ?? null]);
}

/**
 * Recent articles for digest — returns those classified in the last N hours.
 */
export async function getRecentArticlesForDigest(
  symbol: string,
  hours:  number = 1,
): Promise<NewsArticle[]> {
  const { rows } = await db.query(`
    SELECT * FROM news_articles
    WHERE $1 = ANY(symbols)
      AND sentiment_score IS NOT NULL
      AND published_at > NOW() - ($2 || ' hours')::interval
    ORDER BY ABS(sentiment_score) DESC
    LIMIT 10
  `, [symbol, hours]);
  return rows.map(rowToArticle);
}

// ─── Polymarket ───────────────────────────────────────────────────────────────

export async function getLatestPolymarketSnaps(
  symbol: string,
  limit:  number = 5,
): Promise<PolymarketSnapshot[]> {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (market_id)
      id, market_id, question, symbols, yes_prob, no_prob, fetched_at
    FROM polymarket_snapshots
    WHERE $1 = ANY(symbols)
    ORDER BY market_id, fetched_at DESC
    LIMIT $2
  `, [symbol, limit]);

  return rows.map((r) => ({
    id:        r['id'] as string,
    marketId:  r['market_id'] as string,
    question:  r['question'] as string,
    symbols:   r['symbols'] as string[],
    yesProb:   r['yes_prob'] as number,
    noProb:    r['no_prob'] as number,
    fetchedAt: (r['fetched_at'] as Date).toISOString(),
  }));
}

// ─── Nitter accounts ──────────────────────────────────────────────────────────

export async function getActiveNitterAccounts(): Promise<NitterAccount[]> {
  const { rows } = await db.query(`
    SELECT handle, display_name, symbols, active
    FROM nitter_accounts
    WHERE active = TRUE
  `);
  return rows.map((r) => ({
    handle:      r['handle'] as string,
    displayName: (r['display_name'] as string | null) ?? null,
    symbols:     (r['symbols'] as string[]) ?? [],
    active:      r['active'] as boolean,
  }));
}

// ─── Custom Feeds ─────────────────────────────────────────────────────────────

export async function getCustomFeeds(activeOnly = false): Promise<CustomNewsFeed[]> {
  const query = activeOnly
    ? `SELECT id, name, url, resolved_feed_url, mode, active, created_at FROM custom_news_feeds WHERE active = TRUE ORDER BY created_at ASC`
    : `SELECT id, name, url, resolved_feed_url, mode, active, created_at FROM custom_news_feeds ORDER BY created_at ASC`;
  const { rows } = await db.query(query);
  return rows.map((r) => ({
    id:              r['id'] as string,
    name:            r['name'] as string,
    url:             r['url'] as string,
    resolvedFeedUrl: (r['resolved_feed_url'] as string | null) ?? null,
    mode:            r['mode'] as 'rss' | 'discovered' | 'html',
    active:          r['active'] as boolean,
    createdAt:       (r['created_at'] as Date).toISOString(),
  }));
}

export async function addCustomFeed(feed: {
  name: string;
  url: string;
  resolvedFeedUrl?: string | null;
  mode?: 'rss' | 'discovered' | 'html';
}): Promise<CustomNewsFeed> {
  const { rows } = await db.query(
    `INSERT INTO custom_news_feeds (name, url, resolved_feed_url, mode, active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (url) DO UPDATE SET
       name = EXCLUDED.name,
       resolved_feed_url = COALESCE(EXCLUDED.resolved_feed_url, custom_news_feeds.resolved_feed_url),
       mode = COALESCE(EXCLUDED.mode, custom_news_feeds.mode),
       active = TRUE
     RETURNING id, name, url, resolved_feed_url, mode, active, created_at`,
    [feed.name, feed.url, feed.resolvedFeedUrl ?? null, feed.mode ?? 'rss'],
  );
  const r = rows[0]!;
  return {
    id:              r['id'] as string,
    name:            r['name'] as string,
    url:             r['url'] as string,
    resolvedFeedUrl: (r['resolved_feed_url'] as string | null) ?? null,
    mode:            r['mode'] as 'rss' | 'discovered' | 'html',
    active:          r['active'] as boolean,
    createdAt:       (r['created_at'] as Date).toISOString(),
  };
}

export async function updateCustomFeed(
  id: string,
  updates: { active?: boolean; name?: string; resolvedFeedUrl?: string; mode?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  if (updates.active !== undefined) {
    params.push(updates.active);
    sets.push(`active = $${params.length}`);
  }
  if (updates.name !== undefined) {
    params.push(updates.name);
    sets.push(`name = $${params.length}`);
  }
  if (updates.resolvedFeedUrl !== undefined) {
    params.push(updates.resolvedFeedUrl);
    sets.push(`resolved_feed_url = $${params.length}`);
  }
  if (updates.mode !== undefined) {
    params.push(updates.mode);
    sets.push(`mode = $${params.length}`);
  }

  if (sets.length === 0) return;

  await db.query(
    `UPDATE custom_news_feeds SET ${sets.join(', ')} WHERE id = $1`,
    params,
  );
}

export async function deleteCustomFeed(id: string): Promise<void> {
  await db.query(`DELETE FROM custom_news_feeds WHERE id = $1`, [id]);
}

/**
 * Fetch latest articles from custom feeds (source = 'custom'),
 * ordered newest-first, unfiltered by chart symbol.
 */
export async function getLatestCustomArticles(limit: number = 20): Promise<NewsArticle[]> {
  const { rows } = await db.query(
    `SELECT * FROM news_articles
     WHERE source = 'custom'
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map(rowToArticle);
}

