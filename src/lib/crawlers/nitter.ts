/**
 * Nitter RSS crawler — free X/Twitter alternative.
 *
 * Nitter exposes RSS feeds for user timelines and search queries.
 * Public instances can go down; we try a fallback list and use the first
 * that responds. No API key required.
 *
 * We load tracked accounts from the nitter_accounts table so the list
 * is configurable without code changes.
 */

import { getActiveNitterAccounts } from '@/lib/db/news';
import type { Crawler, RawArticle } from './types';

/**
 * Public Nitter instance fallback list.
 * Tried in order — first successful response wins.
 */
const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

/** Grab first match of a tag from a small XML snippet. */
function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim()
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function splitItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[0]);
  return items;
}

async function fetchNitterFeed(path: string): Promise<string | null> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${instance}${path}`, {
        headers: { 'User-Agent': 'RMC-Crypto-Bot/1.0 (personal monitoring tool)' },
        signal:  AbortSignal.timeout(8_000),
      });
      if (res.ok) return await res.text();
    } catch {
      // Try next instance
    }
  }
  return null;
}

function parseNitterItem(block: string, handle: string): RawArticle | null {
  const title = extractTag(block, 'title');
  if (!title) return null;

  const link    = extractTag(block, 'link') ?? '';
  const guidRaw = extractTag(block, 'guid') ?? link;
  // Extract tweet ID from URL like https://nitter.net/user/status/123456
  const tweetId = guidRaw.match(/status\/(\d+)/)?.[1] ?? guidRaw;

  const dateStr = extractTag(block, 'pubDate') ?? '';
  const publishedAt = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(publishedAt.getTime())) return null;

  const bodyRaw = extractTag(block, 'description') ?? '';
  const body    = stripHtml(bodyRaw).slice(0, 500) || undefined;

  // Canonical Twitter URL (not Nitter instance URL — stays valid even if instance dies)
  const url = `https://x.com/${handle}/status/${tweetId}`;

  return {
    source:      'nitter',
    externalId:  tweetId,
    url,
    title:       stripHtml(title).slice(0, 300),
    body,
    author:      `@${handle}`,
    publishedAt,
  };
}

export class NitterCrawler implements Crawler {
  readonly name = 'nitter';
  private readonly handle: string;

  constructor(handle: string) {
    this.handle = handle;
  }

  async fetch(): Promise<RawArticle[]> {
    const xml = await fetchNitterFeed(`/${this.handle}/rss`);
    if (!xml) {
      console.warn(`[nitter:@${this.handle}] all instances failed`);
      return [];
    }

    const items    = splitItems(xml);
    const articles: RawArticle[] = [];

    for (const block of items) {
      const article = parseNitterItem(block, this.handle);
      if (article) articles.push(article);
    }

    return articles;
  }
}

/**
 * Build crawlers for all active Nitter accounts from the DB.
 * Falls back to an empty list if the DB is unreachable.
 */
export async function buildNitterCrawlers(): Promise<NitterCrawler[]> {
  try {
    const accounts = await getActiveNitterAccounts();
    return accounts.map((a) => new NitterCrawler(a.handle));
  } catch (err) {
    console.error('[nitter] failed to load accounts from DB:', (err as Error).message);
    return [];
  }
}
