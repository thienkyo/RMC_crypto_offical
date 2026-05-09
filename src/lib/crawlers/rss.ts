/**
 * Generic RSS 2.0 / Atom 1.0 crawler.
 *
 * Parses feeds without any external XML library — uses a simple but robust
 * regex + string extraction approach that handles the real-world formatting
 * of all target feeds (CoinDesk, CoinTelegraph, Decrypt, The Block, BeInCrypto).
 *
 * Limitations: not a full XML parser — doesn't handle CDATA edge-cases in
 * attributes, but works fine for the text content we care about.
 */

import type { Crawler, RawArticle } from './types';

/** Grab the first occurrence of a tag's text content. Returns null if missing. */
function extractTag(xml: string, tag: string): string | null {
  // Handle both <tag>text</tag> and <tag><![CDATA[text]]></tag>
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return null;
  // CDATA group or plain text group
  const raw = (m[1] ?? m[2] ?? '').trim();
  // Decode basic HTML entities
  return decodeEntities(raw);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)));
}

/** Strip all HTML tags from a string. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Split XML into item/entry blocks. Handles both RSS 2.0 and Atom 1.0. */
function splitItems(xml: string): string[] {
  const items: string[] = [];
  // Try RSS <item> first, then Atom <entry>
  for (const tag of ['item', 'entry']) {
    const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      items.push(m[0]);
    }
    if (items.length > 0) break;
  }
  return items;
}

function parseItem(block: string, sourceName: string): RawArticle | null {
  const title = extractTag(block, 'title');
  if (!title) return null;

  // URL: <link> in RSS, <link href="..."> in Atom, or <guid>
  let url =
    extractTag(block, 'link') ??
    block.match(/<link[^>]+href="([^"]+)"/i)?.[1] ??
    extractTag(block, 'guid') ??
    '';

  url = url.trim();
  if (!url.startsWith('http')) return null;

  // Date: pubDate (RSS) or published/updated (Atom)
  const dateStr =
    extractTag(block, 'pubDate') ??
    extractTag(block, 'published') ??
    extractTag(block, 'updated') ??
    '';
  const publishedAt = dateStr ? new Date(dateStr) : new Date();
  if (isNaN(publishedAt.getTime())) return null;

  // Body: description (RSS) or content (Atom) or summary
  const bodyRaw =
    extractTag(block, 'description') ??
    extractTag(block, 'content') ??
    extractTag(block, 'summary') ??
    '';
  const body = stripHtml(bodyRaw).slice(0, 500) || undefined;

  const author =
    extractTag(block, 'author') ??
    extractTag(block, 'name') ??   // Atom author/name
    extractTag(block, 'dc:creator') ??
    undefined;

  // Stable dedup key: URL is canonical across fetches
  const externalId = url;

  return { source: sourceName, externalId, url, title, body, author: author ?? undefined, publishedAt };
}

// ─── Named RSS feed configs ────────────────────────────────────────────────

interface FeedConfig {
  name:  string;
  url:   string;
}

export const RSS_FEEDS: FeedConfig[] = [
  { name: 'coindesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'decrypt',       url: 'https://decrypt.co/feed' },
  { name: 'theblock',      url: 'https://www.theblock.co/rss.xml' },
  { name: 'beincrypto',    url: 'https://beincrypto.com/feed/' },
];

export class RssCrawler implements Crawler {
  readonly name: string;
  private readonly feedUrl: string;

  constructor(config: FeedConfig) {
    this.name    = config.name;
    this.feedUrl = config.url;
  }

  async fetch(): Promise<RawArticle[]> {
    let xml: string;
    try {
      const res = await fetch(this.feedUrl, {
        headers: { 'User-Agent': 'RMC-Crypto-Bot/1.0 (personal monitoring tool)' },
        signal:  AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      console.error(`[rss:${this.name}] fetch failed:`, (err as Error).message);
      return [];
    }

    const items   = splitItems(xml);
    const articles: RawArticle[] = [];

    for (const block of items) {
      const article = parseItem(block, this.name);
      if (article) articles.push(article);
    }

    return articles;
  }
}

/** Instantiate all configured RSS crawlers. */
export function buildRssCrawlers(): RssCrawler[] {
  return RSS_FEEDS.map((cfg) => new RssCrawler(cfg));
}
