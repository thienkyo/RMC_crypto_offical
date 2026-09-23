/**
 * YouTube Channel RSS Crawler.
 *
 * Reads free official YouTube channel RSS feeds (https://www.youtube.com/feeds/videos.xml?channel_id=...)
 * to ingest new video titles, descriptions, and market commentary without API keys.
 *
 * Server-side only.
 */

import type { Crawler, RawArticle } from './types';
import { upsertArticles, type PersistResult } from './persist';

export interface TrackedYouTubeChannel {
  name: string;
  channelId: string;
}

export const DEFAULT_YOUTUBE_CHANNELS: TrackedYouTubeChannel[] = [
  { name: 'Coin Bureau', channelId: 'UCqK_GSMbpiV8spgD3ZGloSw' },
  { name: 'Benjamin Cowen', channelId: 'UCRvqjQPSeaWn-uEx-w0XOIg' },
  { name: 'Bloomberg Technology', channelId: 'UCrM7B7SL_g1edFMindo0PQg' },
];

export class YouTubeCrawler implements Crawler {
  readonly name = 'youtube';
  private channels: TrackedYouTubeChannel[];

  constructor(channels: TrackedYouTubeChannel[] = DEFAULT_YOUTUBE_CHANNELS) {
    this.channels = channels;
  }

  async fetch(): Promise<RawArticle[]> {
    const allArticles: RawArticle[] = [];

    for (const ch of this.channels) {
      try {
        const articles = await fetchYouTubeChannelRss(ch.channelId, ch.name);
        allArticles.push(...articles);
      } catch (err) {
        console.warn(`[youtube-crawler] Failed to fetch channel ${ch.name} (${ch.channelId}):`, err);
      }
    }

    return allArticles;
  }

  async run(): Promise<PersistResult> {
    const raw = await this.fetch();
    return upsertArticles(raw);
  }
}

export async function fetchYouTubeChannelRss(channelId: string, channelName: string): Promise<RawArticle[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RMCNewsCrawler/1.0)',
      Accept: 'application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching YouTube RSS for ${channelId}`);
  }

  const xml = await res.text();
  return parseYouTubeAtomXml(xml, channelName);
}

export function parseYouTubeAtomXml(xml: string, channelName: string): RawArticle[] {
  const articles: RawArticle[] = [];

  // Match <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1] ?? '';

    const idMatch = entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)
      || entryXml.match(/<id>[^:]+:video:([^<]+)<\/id>/i);
    const videoId = idMatch?.[1]?.trim();
    if (!videoId) continue;

    const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeXml(titleMatch?.[1] ?? '').trim();
    if (!title) continue;

    const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/i);
    const publishedAt = publishedMatch ? new Date(publishedMatch[1]!) : new Date();

    const descMatch = entryXml.match(/<media:description>([\s\S]*?)<\/media:description>/i);
    const body = decodeXml(descMatch?.[1] ?? '').slice(0, 500).trim();

    articles.push({
      source: 'youtube',
      externalId: `yt_${videoId}`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      body: body || title,
      author: channelName,
      publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  }

  // Keep latest 8 videos per channel
  return articles.slice(0, 8);
}

function decodeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
