/**
 * Tech News Crawler.
 *
 * Ingests tech & financial technology stories from:
 * 1. Official Hacker News Firebase API (top stories)
 * 2. TechCrunch RSS feed
 *
 * Server-side only. Free, zero credentials required.
 */

import type { Crawler, RawArticle } from './types';
import { upsertArticles, type PersistResult } from './persist';

const HN_TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const HN_ITEM_BASE_URL   = 'https://hacker-news.firebaseio.com/v0/item';
const TECHCRUNCH_RSS_URL = 'https://techcrunch.com/feed/';

interface HnItem {
  id: number;
  title?: string;
  url?: string;
  by?: string;
  time?: number;
  score?: number;
  text?: string;
}

export class TechNewsCrawler implements Crawler {
  readonly name = 'technews';

  async fetch(): Promise<RawArticle[]> {
    const articles: RawArticle[] = [];

    // 1. Fetch Hacker News Top 20
    try {
      const hnArticles = await fetchHackerNewsTop(20);
      articles.push(...hnArticles);
    } catch (err) {
      console.warn('[technews-crawler] Failed to fetch Hacker News:', err);
    }

    // 2. Fetch TechCrunch RSS
    try {
      const tcArticles = await fetchTechCrunchRss();
      articles.push(...tcArticles);
    } catch (err) {
      console.warn('[technews-crawler] Failed to fetch TechCrunch RSS:', err);
    }

    return articles;
  }

  async run(): Promise<PersistResult> {
    const raw = await this.fetch();
    return upsertArticles(raw);
  }
}

async function fetchHackerNewsTop(limit = 20): Promise<RawArticle[]> {
  const res = await fetch(HN_TOP_STORIES_URL, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`HN topstories HTTP ${res.status}`);

  const ids = (await res.json()) as number[];
  const targetIds = ids.slice(0, limit);

  const fetchItems = targetIds.map(async (id) => {
    try {
      const itemRes = await fetch(`${HN_ITEM_BASE_URL}/${id}.json`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!itemRes.ok) return null;
      return (await itemRes.json()) as HnItem;
    } catch {
      return null;
    }
  });

  const items = await Promise.all(fetchItems);
  const articles: RawArticle[] = [];

  for (const item of items) {
    if (!item || !item.title) continue;

    articles.push({
      source: 'technews',
      externalId: `hn_${item.id}`,
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      title: item.title,
      body: item.text ? item.text.slice(0, 500) : `Score: ${item.score ?? 0} on Hacker News`,
      author: item.by ? `HN / ${item.by}` : 'Hacker News',
      publishedAt: item.time ? new Date(item.time * 1000) : new Date(),
    });
  }

  return articles;
}

async function fetchTechCrunchRss(): Promise<RawArticle[]> {
  const res = await fetch(TECHCRUNCH_RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RMCNewsCrawler/1.0)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`TechCrunch RSS HTTP ${res.status}`);

  const xml = await res.text();
  const articles: RawArticle[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1] ?? '';

    const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeXml(titleMatch?.[1] ?? '').trim();
    if (!title) continue;

    const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const url = (linkMatch?.[1] ?? '').trim();
    if (!url) continue;

    const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const publishedAt = pubDateMatch ? new Date(pubDateMatch[1]!) : new Date();

    const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const body = decodeXml(descMatch?.[1] ?? '').slice(0, 500).trim();

    articles.push({
      source: 'technews',
      externalId: `tc_${encodeURIComponent(url)}`,
      url,
      title,
      body,
      author: 'TechCrunch',
      publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });

    if (articles.length >= 10) break;
  }

  return articles;
}

function decodeXml(str: string): string {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
