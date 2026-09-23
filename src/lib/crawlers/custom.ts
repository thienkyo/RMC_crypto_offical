/**
 * Custom news crawler with 3-tier resolution:
 *  1. Direct RSS / Atom feed
 *  2. Auto-discovery via HTML <link rel="alternate" type="application/rss+xml">
 *  3. Heuristic HTML article link extraction fallback
 *
 * Keeps up to 4 latest items per feed, persisted into news_articles with source='custom'.
 */

import { splitItems, parseItem, stripHtml } from './rss';
import { upsertArticles } from './persist';
import { getCustomFeeds, updateCustomFeed } from '@/lib/db/news';
import type { RawArticle } from './types';
import type { TestFeedResult } from '@/types/news';

const USER_AGENT = 'Mozilla/5.0 (compatible; RMCNewsCrawler/1.0; +https://github.com/rmc/crypto)';
const FETCH_TIMEOUT_MS = 10_000;

/** Fetch text content with user agent and timeout */
async function fetchWithTimeout(url: string): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    return { text, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** Check if text looks like RSS or Atom XML */
function isXmlFeed(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<?xml') ||
    trimmed.includes('<rss') ||
    trimmed.includes('<feed') ||
    trimmed.includes('<rdf:RDF')
  );
}

/** Extract auto-discovered RSS/Atom feed URL from HTML <head> */
function discoverFeedUrl(html: string, baseUrl: string): string | null {
  // Look for <link rel="alternate" type="application/rss+xml" href="..."> or atom+xml
  const linkRegex = /<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["'])[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (hrefMatch?.[1]) {
      try {
        return new URL(hrefMatch[1], baseUrl).toString();
      } catch {
        // invalid URL
      }
    }
  }

  // Also check reverse attribute order: href before type
  const reverseRegex = /<link[^>]+href=["']([^"']+)["'][^>]+(?:type=["']application\/(?:rss|atom)\+xml["'])[^>]*>/gi;
  while ((match = reverseRegex.exec(html)) !== null) {
    if (match[1]) {
      try {
        return new URL(match[1], baseUrl).toString();
      } catch {
        // invalid URL
      }
    }
  }

  return null;
}

/** Tier-3 Fallback: Heuristic extraction of article links from standard HTML */
function extractHtmlArticles(html: string, baseUrl: string, sourceName: string): RawArticle[] {
  const articles: RawArticle[] = [];
  const seenUrls = new Set<string>();

  // Scan <a> tags with text and href
  const aRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  let baseOrigin = '';
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  while ((match = aRegex.exec(html)) !== null) {
    const href = match[1]?.trim();
    const rawText = match[2] ?? '';
    const title = stripHtml(rawText).trim();

    if (!href || !title || title.length < 25 || title.length > 200) continue;

    let fullUrl: string;
    try {
      fullUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    // Must be same origin (not external ads or social icons)
    if (!fullUrl.startsWith(baseOrigin)) continue;

    // Filter out common non-article links
    const lowerUrl = fullUrl.toLowerCase();
    if (
      lowerUrl.includes('/tag/') ||
      lowerUrl.includes('/category/') ||
      lowerUrl.includes('/author/') ||
      lowerUrl.includes('/privacy') ||
      lowerUrl.includes('/terms') ||
      lowerUrl.includes('/about') ||
      lowerUrl.includes('/contact') ||
      lowerUrl.includes('#')
    ) {
      continue;
    }

    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    articles.push({
      source: 'custom',
      externalId: fullUrl,
      url: fullUrl,
      title,
      author: sourceName,
      publishedAt: new Date(),
    });

    if (articles.length >= 4) break;
  }

  return articles;
}

export interface ResolvedFeed {
  mode: 'rss' | 'discovered' | 'html';
  feedUrl: string;
  articles: RawArticle[];
}

/**
 * Resolve a URL through the 3 tiers (RSS -> Auto-discovery -> HTML fallback).
 */
export async function resolveAndFetchFeed(
  url: string,
  sourceName: string,
  maxItems = 4,
): Promise<ResolvedFeed> {
  const { text, contentType } = await fetchWithTimeout(url);

  // Tier 1: Direct RSS / Atom XML
  if (contentType.includes('xml') || isXmlFeed(text)) {
    const rawItems = splitItems(text).slice(0, maxItems);
    const articles: RawArticle[] = [];
    for (const block of rawItems) {
      const parsed = parseItem(block, 'custom');
      if (parsed) {
        articles.push({ ...parsed, author: sourceName });
      }
    }

    if (articles.length > 0) {
      return { mode: 'rss', feedUrl: url, articles };
    }
  }

  // Tier 2: Auto-discover feed link from HTML head
  const discoveredUrl = discoverFeedUrl(text, url);
  if (discoveredUrl && discoveredUrl !== url) {
    try {
      const { text: feedXml } = await fetchWithTimeout(discoveredUrl);
      if (isXmlFeed(feedXml)) {
        const rawItems = splitItems(feedXml).slice(0, maxItems);
        const articles: RawArticle[] = [];
        for (const block of rawItems) {
          const parsed = parseItem(block, 'custom');
          if (parsed) {
            articles.push({ ...parsed, author: sourceName });
          }
        }

        if (articles.length > 0) {
          return { mode: 'discovered', feedUrl: discoveredUrl, articles };
        }
      }
    } catch (err) {
      console.warn(`[custom-crawler] Auto-discovered feed fetch failed for ${discoveredUrl}:`, err);
    }
  }

  // Tier 3: HTML link extraction fallback
  const fallbackArticles = extractHtmlArticles(text, url, sourceName);
  if (fallbackArticles.length > 0) {
    return { mode: 'html', feedUrl: url, articles: fallbackArticles };
  }

  throw new Error('No RSS/Atom feed or article links could be extracted from this URL');
}

/**
 * Test a feed URL without persisting anything to the database.
 * Used by the Settings page "Test" button.
 */
export async function testCustomFeed(url: string): Promise<TestFeedResult> {
  const cleanUrl = url.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return { ok: false, error: 'URL must start with http:// or https://' };
  }

  try {
    const resolved = await resolveAndFetchFeed(cleanUrl, 'Test Feed', 4);
    return {
      ok: true,
      mode: resolved.mode,
      itemCount: resolved.articles.length,
      sampleTitles: resolved.articles.map((a) => a.title).slice(0, 3),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to reach or parse feed',
    };
  }
}

/**
 * Crawl all active custom feeds, cap at 4 articles per feed, and upsert into news_articles.
 */
export async function crawlCustomFeeds(): Promise<{ crawled: number; inserted: number; errors: string[] }> {
  const feeds = await getCustomFeeds(true);
  let totalInserted = 0;
  const errors: string[] = [];

  for (const feed of feeds) {
    try {
      const targetUrl = feed.resolvedFeedUrl || feed.url;
      const resolved = await resolveAndFetchFeed(targetUrl, feed.name, 4);

      // If discovered a feed URL, cache it in DB so subsequent crawls bypass discovery
      if (resolved.mode === 'discovered' && resolved.feedUrl !== feed.resolvedFeedUrl) {
        await updateCustomFeed(feed.id, {
          resolvedFeedUrl: resolved.feedUrl,
          mode: resolved.mode,
        });
      }

      if (resolved.articles.length > 0) {
        const res = await upsertArticles(resolved.articles);
        totalInserted += res.inserted;
      }
    } catch (err) {
      const msg = `${feed.name} (${feed.url}): ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[custom-crawler] Failed to crawl feed: ${msg}`);
      errors.push(msg);
    }
  }

  return { crawled: feeds.length, inserted: totalInserted, errors };
}
