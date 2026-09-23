import { describe, it, expect } from 'vitest';
import { parseTelegramHtml } from './telegram';
import { parseYouTubeAtomXml } from './youtube';

describe('Crawlers Extension Tests', () => {
  it('parses Telegram public web preview HTML correctly', () => {
    const sampleHtml = `
      <div class="tgme_widget_message" data-post="binance_announcements/1234">
        <div class="tgme_widget_message_text js-message_text">
          Binance will list Bittensor (TAO) with Seed Tag Applied. Trading opens at 12:00 UTC.
        </div>
        <time datetime="2026-05-28T09:30:00+00:00"></time>
      </div>
    `;

    const articles = parseTelegramHtml(sampleHtml, 'binance_announcements');
    expect(articles).toHaveLength(1);
    expect(articles[0]!.source).toBe('telegram');
    expect(articles[0]!.author).toBe('@binance_announcements');
    expect(articles[0]!.url).toBe('https://t.me/binance_announcements/1234');
    expect(articles[0]!.title).toContain('Binance will list Bittensor');
    expect(articles[0]!.externalId).toBe('tg_binance_announcements_1234');
  });

  it('parses YouTube Atom XML feeds correctly', () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <entry>
          <id>yt:video:dQw4w9WgXcQ</id>
          <yt:videoId>dQw4w9WgXcQ</yt:videoId>
          <title>Bitcoin Massive Breakout Imminent? Macro Liquidity Analysis</title>
          <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
          <published>2026-05-28T14:00:00+00:00</published>
          <media:group>
            <media:description>In this video we analyze Bitcoin cycles, M2 money supply, and key resistance levels.</media:description>
          </media:group>
        </entry>
      </feed>
    `;

    const articles = parseYouTubeAtomXml(sampleXml, 'Benjamin Cowen');
    expect(articles).toHaveLength(1);
    expect(articles[0]!.source).toBe('youtube');
    expect(articles[0]!.author).toBe('Benjamin Cowen');
    expect(articles[0]!.title).toContain('Bitcoin Massive Breakout');
    expect(articles[0]!.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(articles[0]!.externalId).toBe('yt_dQw4w9WgXcQ');
  });
});
