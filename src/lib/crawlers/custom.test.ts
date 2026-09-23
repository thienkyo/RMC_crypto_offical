import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAndFetchFeed, testCustomFeed } from './custom';

describe('Custom News Crawler & Feed Discovery', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SemiAnalysis</title>
    <link>https://www.semianalysis.com</link>
    <description>Semiconductor and AI research</description>
    <item>
      <title>NVIDIA Blackwell Architecture and HBM3e Memory Deep Dive</title>
      <link>https://www.semianalysis.com/p/nvidia-blackwell-b200</link>
      <description>Analyzing NVDA B200 GPU architecture, Micron HBM3e packaging and power demands.</description>
      <pubDate>Wed, 23 Sep 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>TSMC 2nm N2 Node and ASML High NA EUV Deployment</title>
      <link>https://www.semianalysis.com/p/tsmc-2nm-asml-euv</link>
      <description>TSMC foundry expansion with ASML advanced lithography tools.</description>
      <pubDate>Tue, 22 Sep 2026 08:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

  const sampleHtmlWithFeedDiscovery = `<!DOCTYPE html>
<html>
  <head>
    <title>Tech Blog</title>
    <link rel="alternate" type="application/rss+xml" title="Tech Blog RSS" href="https://example.com/feed.xml" />
  </head>
  <body>
    <h1>Welcome to Tech Blog</h1>
  </body>
</html>`;

  const sampleHtmlFallback = `<!DOCTYPE html>
<html>
  <head>
    <title>Plain Hardware News</title>
  </head>
  <body>
    <div class="news-list">
      <a href="https://hardware.example.com/news/intel-18a-foundry-progress">Intel 18A Node Manufacturing Update and Panther Lake CPU Details</a>
      <a href="https://hardware.example.com/news/micron-ram-hbm4-roadmap">Micron Technology Announces HBM4 Development for Next-Gen AI Clusters</a>
      <a href="https://hardware.example.com/about">About Us</a>
      <a href="https://hardware.example.com/contact">Contact Us</a>
    </div>
  </body>
</html>`;

  it('Tier 1: parses direct RSS XML feed correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/rss+xml' }),
      text: async () => sampleRssXml,
    });

    const res = await resolveAndFetchFeed('https://www.semianalysis.com/feed', 'SemiAnalysis', 4);
    expect(res.mode).toBe('rss');
    expect(res.articles.length).toBe(2);
    expect(res.articles[0]?.title).toBe('NVIDIA Blackwell Architecture and HBM3e Memory Deep Dive');
    expect(res.articles[0]?.url).toBe('https://www.semianalysis.com/p/nvidia-blackwell-b200');
    expect(res.articles[0]?.author).toBe('SemiAnalysis');
    expect(res.articles[0]?.source).toBe('custom');
  });

  it('Tier 2: auto-discovers feed URL from HTML <link rel="alternate">', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://example.com') {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => sampleHtmlWithFeedDiscovery,
        };
      }
      if (url === 'https://example.com/feed.xml') {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/rss+xml' }),
          text: async () => sampleRssXml,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const res = await resolveAndFetchFeed('https://example.com', 'Tech Blog', 4);
    expect(res.mode).toBe('discovered');
    expect(res.feedUrl).toBe('https://example.com/feed.xml');
    expect(res.articles.length).toBe(2);
    expect(res.articles[0]?.title).toContain('NVIDIA Blackwell');
  });

  it('Tier 3: extracts article links from plain HTML when no RSS feed exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => sampleHtmlFallback,
    });

    const res = await resolveAndFetchFeed('https://hardware.example.com', 'Hardware News', 4);
    expect(res.mode).toBe('html');
    expect(res.articles.length).toBe(2);
    expect(res.articles[0]?.title).toBe('Intel 18A Node Manufacturing Update and Panther Lake CPU Details');
    expect(res.articles[0]?.url).toBe('https://hardware.example.com/news/intel-18a-foundry-progress');
    // Ensure navigation links like /about and /contact were filtered out
    expect(res.articles.some((a) => a.url.includes('/about'))).toBe(false);
  });

  it('testCustomFeed returns diagnostic info without throwing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/rss+xml' }),
      text: async () => sampleRssXml,
    });

    const result = await testCustomFeed('https://www.semianalysis.com/feed');
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('rss');
    expect(result.itemCount).toBe(2);
    expect(result.sampleTitles?.length).toBe(2);
  });

  it('testCustomFeed gracefully reports errors for invalid or offline URLs', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('DNS lookup failed'));

    const result = await testCustomFeed('https://unreachable-domain-xyz.net');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('DNS lookup failed');
  });
});
