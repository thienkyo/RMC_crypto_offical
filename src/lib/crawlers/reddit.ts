/**
 * Reddit crawler — uses the official Reddit API with OAuth2 client_credentials.
 *
 * Setup:
 *   1. Go to https://www.reddit.com/prefs/apps
 *   2. Create a "script" app (personal use)
 *   3. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env.local
 *
 * Token caching: Reddit access tokens last 1 hour. We cache in a module-level
 * variable — safe for a single Next.js server process (dev or Vercel serverless).
 *
 * Rate limit: 100 req/min on free tier. We crawl at most once per 30 min per
 * subreddit, so we stay well within limits.
 */

import type { Crawler, RawArticle } from './types';

const SUBREDDITS = [
  'cryptocurrency',
  'bitcoin',
  'ethtrader',
  'CryptoMarkets',
];

const TOKEN_URL     = 'https://www.reddit.com/api/v1/access_token';
const OAUTH_API_URL = 'https://oauth.reddit.com';
const USER_AGENT    = 'RMC-Crypto-Bot/1.0 (personal monitoring tool by u/rmc_bot)';

interface RedditToken {
  value:     string;
  expiresAt: number; // Date.now() ms
}

// Module-level token cache — survives across cron invocations in the same process
let cachedToken: RedditToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const clientId     = process.env['REDDIT_CLIENT_ID'];
  const clientSecret = process.env['REDDIT_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    throw new Error('REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET is not set.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'User-Agent':  USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body:   'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Reddit token error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    value:     data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.value;
}

interface RedditPost {
  id:          string;
  title:       string;
  url:         string;
  selftext:    string;
  author:      string;
  created_utc: number;
  permalink:   string;
  subreddit:   string;
}

export class RedditCrawler implements Crawler {
  readonly name = 'reddit';
  readonly subreddit: string;

  constructor(subreddit: string) {
    this.subreddit = subreddit;
  }

  async fetch(): Promise<RawArticle[]> {
    let token: string;
    try {
      token = await getAccessToken();
    } catch (err) {
      console.error(`[reddit:${this.subreddit}] auth failed:`, (err as Error).message);
      return [];
    }

    let res: Response;
    try {
      res = await fetch(
        `${OAUTH_API_URL}/r/${this.subreddit}/new.json?limit=25&raw_json=1`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent':  USER_AGENT,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (err) {
      console.error(`[reddit:${this.subreddit}] fetch failed:`, (err as Error).message);
      return [];
    }

    if (!res.ok) {
      console.error(`[reddit:${this.subreddit}] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as { data: { children: Array<{ data: RedditPost }> } };
    const posts = data.data.children.map((c) => c.data);

    return posts.map((post): RawArticle => ({
      source:      'reddit',
      externalId:  post.id,
      url:         `https://reddit.com${post.permalink}`,
      title:       post.title,
      body:        post.selftext ? post.selftext.slice(0, 500) : undefined,
      author:      `u/${post.author}`,
      publishedAt: new Date(post.created_utc * 1000),
    }));
  }
}

export function buildRedditCrawlers(): RedditCrawler[] {
  return SUBREDDITS.map((sub) => new RedditCrawler(sub));
}
