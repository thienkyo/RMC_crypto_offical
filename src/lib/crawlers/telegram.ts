/**
 * Telegram Public Channel Web Preview Crawler.
 *
 * Scrapes public Telegram web channels (https://t.me/s/<channel>) without requiring
 * user session credentials or risking account bans.
 *
 * Server-side only.
 */

import type { Crawler, RawArticle } from './types';
import { upsertArticles, type PersistResult } from './persist';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export const DEFAULT_TELEGRAM_CHANNELS = [
  'binance_announcements',
  'whale_alert_io',
  'coindesk',
  'WatcherGuru',
];

export class TelegramCrawler implements Crawler {
  readonly name = 'telegram';
  private channels: string[];

  constructor(channels: string[] = DEFAULT_TELEGRAM_CHANNELS) {
    this.channels = channels;
  }

  async fetch(): Promise<RawArticle[]> {
    const allArticles: RawArticle[] = [];

    for (const channel of this.channels) {
      try {
        const articles = await fetchTelegramChannel(channel);
        allArticles.push(...articles);
      } catch (err) {
        console.warn(`[telegram-crawler] Failed to fetch channel @${channel}:`, err);
      }
    }

    return allArticles;
  }

  async run(): Promise<PersistResult> {
    const raw = await this.fetch();
    return upsertArticles(raw);
  }
}

/**
 * Fetch and parse the public web preview of a Telegram channel.
 */
export async function fetchTelegramChannel(channelHandle: string): Promise<RawArticle[]> {
  const cleanHandle = channelHandle.replace(/^@/, '').trim();
  const url = `https://t.me/s/${cleanHandle}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching Telegram channel ${cleanHandle}`);
  }

  const html = await res.text();
  return parseTelegramHtml(html, cleanHandle);
}

export function parseTelegramHtml(html: string, channelHandle: string): RawArticle[] {
  const articles: RawArticle[] = [];

  // Match message blocks
  const msgBlockRegex = /<div class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div class="[^"]*tgme_widget_message\b|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = msgBlockRegex.exec(html)) !== null) {
    const postId = match[1] ?? '';
    const blockContent = match[0];

    // Extract message text
    const textMatch = blockContent.match(/<div class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch || !textMatch[1]) continue;

    const rawText = textMatch[1];
    const cleanText = stripHtml(rawText);
    if (!cleanText || cleanText.length < 15) continue;

    // Extract timestamp
    const timeMatch = blockContent.match(/<time[^>]*datetime="([^"]+)"/i);
    const pubDate = timeMatch && timeMatch[1] ? new Date(timeMatch[1]) : new Date();

    const title = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;
    const postUrl = `https://t.me/${postId}`;

    articles.push({
      source: 'telegram',
      externalId: `tg_${postId.replace('/', '_')}`,
      url: postUrl,
      title,
      body: cleanText,
      author: `@${channelHandle}`,
      publishedAt: isNaN(pubDate.getTime()) ? new Date() : pubDate,
    });
  }

  // Keep latest 15 messages
  return articles.slice(-15).reverse();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
