# Phase 4 Plan: News & Social Ingestion + Sentiment

> **Status:** Planned — begins after Phase 3 (AI chart analysis) is complete.
> **Goal:** A per-symbol news feed with sentiment scoring, sourced from free APIs, classified by Gemini (bulk) and summarised by Claude (highlights), rendered in the right rail of the dashboard.

---

## 1. Goal (one line)

Pull news and social signals from free public sources, classify each item's sentiment, and surface a live per-symbol feed with a sentiment heat indicator and hourly digest in the dashboard UI.

---

## 2. Decisions Made

| Question | Decision |
|---|---|
| Sources | RSS feeds, Reddit, Nitter (X fallback), Polymarket, free crypto aggregator APIs |
| X / Twitter | Nitter RSS (free, no key) — not the paid X API |
| Build order | After Phase 3 (AI chart analysis) |
| Crawler infra | Next.js cron routes on Vercel |
| Embeddings | Skipped for now — add pgvector semantic search in Phase 5+ |
| Sentiment schema | `score` (float −1 to +1) + `label` (bearish/neutral/bullish) + `summary` (1-sentence Claude) |

---

## 3. Data Sources

### 3a. Free News APIs / RSS (no key required)

| Source | Type | Cost | Notes |
|---|---|---|---|
| **CryptoPanic** | REST API | Free (50 req/hr on free tier) | Best aggregator; covers 100+ outlets; has community sentiment vote built in |
| **cryptocurrency.cv** | REST + RSS | Free, no key | Open-source aggregator; multi-source; TypeScript SDK available |
| **CoinDesk** | RSS | Free | `https://www.coindesk.com/arc/outboundfeeds/rss/` |
| **CoinTelegraph** | RSS | Free | `https://cointelegraph.com/rss` |
| **Decrypt** | RSS | Free | `https://decrypt.co/feed` |
| **The Block** | RSS | Free | `https://www.theblock.co/rss.xml` |
| **BeInCrypto** | RSS | Free | `https://beincrypto.com/feed/` |

### 3b. Social

| Source | Type | Cost | Notes |
|---|---|---|---|
| **Reddit** | Official API | Free (OAuth, 100 req/min) | r/cryptocurrency, r/bitcoin, r/ethtrader, r/CryptoMarkets |
| **Nitter RSS** | RSS | Free, no key | Public Nitter instance RSS for tracked accounts/hashtags. Fallback list needed (instances go down). |

### 3c. Prediction Markets

| Source | Type | Cost | Notes |
|---|---|---|---|
| **Polymarket** | Public REST API | Free, no key | Fetch market odds per coin; treat probability as a sentiment signal |

### Tracked Nitter Accounts (starter list)
`PlanB`, `woonomic`, `CryptoCapo_`, `AltcoinPsycho`, `inversebrah`, `CryptoCred` — configurable in DB, not hardcoded.

---

## 4. Database Schema

Add to `schema.sql`:

```sql
-- ── News articles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_articles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source          VARCHAR(50) NOT NULL,         -- 'coindesk' | 'reddit' | 'nitter' | 'polymarket' | 'cryptopanic' | ...
  external_id     VARCHAR(500) NOT NULL,        -- dedup key: URL hash or native source ID
  url             TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT,                         -- first ~500 chars or summary; NOT full article
  author          VARCHAR(200),
  published_at    TIMESTAMPTZ NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbols         TEXT[]      NOT NULL DEFAULT '{}',  -- ['BTCUSDT','ETHUSDT'] — matched entities
  sentiment_score FLOAT,                        -- NULL = unclassified; -1.0 bearish → +1.0 bullish
  sentiment_label VARCHAR(10),                  -- 'bearish' | 'neutral' | 'bullish'
  sentiment_summary TEXT,                       -- 1-sentence Claude summary (high-signal articles only)
  sentiment_model VARCHAR(60),                  -- 'gemini-2.0-flash' | 'claude-sonnet-4-6' etc.
  credibility     FLOAT       NOT NULL DEFAULT 1.0,  -- per-source weight (tunable)
  UNIQUE (source, external_id)
);

-- Per-symbol feed query: pull recent articles mentioning a symbol
CREATE INDEX IF NOT EXISTS news_symbols_gin   ON news_articles USING GIN (symbols);
CREATE INDEX IF NOT EXISTS news_published_idx ON news_articles (published_at DESC);

-- ── Tracked Nitter accounts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nitter_accounts (
  handle      VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(200),
  symbols     TEXT[]   DEFAULT '{}',    -- coins this account focuses on (hint for entity extraction)
  active      BOOLEAN  DEFAULT TRUE
);

-- ── Polymarket snapshot ───────────────────────────────────────────────────
-- Stored as a separate time-series so we can chart odds over time
CREATE TABLE IF NOT EXISTS polymarket_snapshots (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   VARCHAR(200) NOT NULL,
  question    TEXT        NOT NULL,
  symbols     TEXT[]      NOT NULL DEFAULT '{}',
  yes_prob    FLOAT       NOT NULL,  -- 0.0 – 1.0
  no_prob     FLOAT       NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS poly_sym_time ON polymarket_snapshots USING GIN (symbols);
```

**Source credibility defaults** (stored as a constant in code, not DB):
```ts
export const SOURCE_CREDIBILITY: Record<string, number> = {
  coindesk:      1.0,
  theblock:      1.0,
  cointelegraph: 0.9,
  decrypt:       0.9,
  beincrypto:    0.8,
  cryptopanic:   0.7,  // aggregator; quality varies
  reddit:        0.6,
  nitter:        0.5,
};
```

---

## 5. Crawler Architecture

### 5a. Approach: Next.js Cron Routes

Each crawler is a `POST /api/cron/<source>` route, secured with a shared `CRON_SECRET` header checked against `process.env.CRON_SECRET`. Vercel calls them on schedule via `vercel.json`.

```json
// vercel.json
{
  "crons": [
    { "path": "/api/cron/crawl-rss",        "schedule": "*/15 * * * *" },
    { "path": "/api/cron/crawl-reddit",     "schedule": "*/30 * * * *" },
    { "path": "/api/cron/crawl-nitter",     "schedule": "*/20 * * * *" },
    { "path": "/api/cron/crawl-polymarket", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/sentiment-run",    "schedule": "*/5  * * * *" }
  ]
}
```

> **Local dev:** hit the cron routes manually via `curl -X POST http://localhost:3000/api/cron/crawl-rss -H "x-cron-secret: dev"` or trigger from a simple dev dashboard.

### 5b. Crawler Interface

All crawlers implement one shared interface so they're trivially swappable:

```ts
// src/lib/crawlers/types.ts
export interface RawArticle {
  source:      string;
  externalId:  string;     // URL hash or native ID — used for dedup
  url:         string;
  title:       string;
  body?:       string;     // truncated text; never store full HTML
  author?:     string;
  publishedAt: Date;
}

export interface Crawler {
  name: string;
  fetch(): Promise<RawArticle[]>;
}
```

### 5c. Dedup & Persist

One shared function used by all cron routes:

```ts
// src/lib/crawlers/persist.ts
// upsertArticles: INSERT ... ON CONFLICT (source, external_id) DO NOTHING
// Then calls extractSymbols() to tag coins/stocks
// Returns count of newly inserted rows
export async function upsertArticles(articles: RawArticle[]): Promise<number>
```

---

## 6. Entity Extraction (Symbol Tagging)

Simple keyword matching on `title + body`. Maintained as a data map, not hardcoded logic:

```ts
// src/lib/sentiment/entity.ts

// Built from the symbols table at startup; refreshed every hour
// Maps lowercase keyword → symbol
// e.g. 'bitcoin' → 'BTCUSDT', 'btc' → 'BTCUSDT', 'apple' → 'AAPL'
export function extractSymbols(text: string): string[]
```

**Rules:**
- Match whole words only (regex word boundaries) to avoid false positives ("bit" ≠ "bitcoin")
- Crypto: use coin name + ticker. Mag7: use company name + ticker.
- Cap at 5 symbols per article — if more match, take the most specific (ticker > name)
- Articles with 0 matched symbols get `symbols = []` and won't appear in per-symbol feeds but are stored for aggregate sentiment

---

## 7. Sentiment Pipeline

### Flow

```
New article (sentiment_score IS NULL)
        │
        ▼
  [Every 5 min] /api/cron/sentiment-run
        │
        ├─ Batch ≤50 unclassified articles
        │
        ├─ Send to Gemini Flash (bulk, cheap)
        │   → score: float, label: string
        │
        └─ For articles where |score| ≥ 0.65 (strong signal)
            └─ Send to Claude Sonnet (1-sentence summary)
```

### Gemini Prompt (bulk classify)

```
You are a financial sentiment classifier for crypto/stock news.
For each article title below, return a JSON array in the same order.
Each element: { "score": <float -1.0 to 1.0>, "label": "bearish"|"neutral"|"bullish" }
Score guide: -1.0 = extremely bearish, 0 = neutral, +1.0 = extremely bullish.
Be conservative — most news is neutral.

Articles:
1. [title]
2. [title]
...
```

### Claude Prompt (1-sentence summary, high-signal only)

```
Summarise this crypto/stock news article in exactly one sentence (max 25 words).
Focus on: what happened, which asset, and the likely market implication.
Do not begin with "This article" or "The article".

Title: [title]
Body: [body]
```

### Cost discipline
- Cache key: `(source, external_id)` — never re-classify the same article
- Batch Gemini calls: 50 articles per API call, not 1-by-1
- Claude summaries: only for `|score| ≥ 0.65` — estimated ~20% of articles
- Store `sentiment_model` so we can audit which version classified what

---

## 8. API Routes

### News Feed
```
GET /api/news/feed
  ?symbol=BTCUSDT    (required)
  &limit=50          (default 50, max 200)
  &since=<ISO8601>   (optional, for pagination)
  &source=reddit     (optional filter)

Response:
{
  articles: NewsArticle[],
  aggregate: {
    score: number,       // weighted average of recent scores
    label: string,
    articleCount: number,
    window: '1h' | '24h'
  }
}
```

### Hourly Digest
```
GET /api/news/digest?symbol=BTCUSDT&window=1h

Response:
{
  digest: string,        // Claude-generated "what changed" paragraph
  articleCount: number,
  generatedAt: string    // ISO timestamp — cached for 30 min
}
```

### Polymarket
```
GET /api/news/polymarket?symbol=BTCUSDT

Response:
{
  markets: PolymarketSnapshot[]
}
```

---

## 9. File Structure

```
src/
├── app/
│   └── api/
│       ├── news/
│       │   ├── feed/route.ts          # GET — per-symbol article feed + aggregate score
│       │   ├── digest/route.ts        # GET — Claude hourly digest (cached 30 min)
│       │   └── polymarket/route.ts    # GET — prediction market odds
│       └── cron/
│           ├── crawl-rss/route.ts        # CoinDesk, CoinTelegraph, Decrypt, The Block, BeInCrypto
│           ├── crawl-reddit/route.ts     # r/cryptocurrency, r/bitcoin, r/ethtrader
│           ├── crawl-nitter/route.ts     # Nitter RSS for tracked accounts
│           ├── crawl-polymarket/route.ts # Polymarket public API
│           └── sentiment-run/route.ts    # Classify unprocessed articles
├── components/
│   └── news/
│       ├── NewsFeed.tsx               # Right-rail scrollable feed
│       ├── NewsItem.tsx               # Single article card
│       ├── SentimentBadge.tsx         # Colored badge: score + label
│       ├── SentimentHeatBar.tsx       # Aggregate sentiment bar (24h window)
│       └── HourlyDigest.tsx           # "What changed in the last hour" block
├── lib/
│   ├── crawlers/
│   │   ├── types.ts                   # RawArticle, Crawler interfaces
│   │   ├── persist.ts                 # upsertArticles() + dedup logic
│   │   ├── rss.ts                     # Generic RSS/Atom parser (uses fast-xml-parser)
│   │   ├── reddit.ts                  # Reddit API client (OAuth client credentials)
│   │   ├── nitter.ts                  # Nitter RSS + fallback instance list
│   │   └── polymarket.ts              # Polymarket public REST client
│   ├── sentiment/
│   │   ├── classify.ts                # Gemini batch sentiment classification
│   │   ├── summarize.ts               # Claude 1-sentence summaries
│   │   ├── digest.ts                  # Claude hourly digest generation
│   │   └── entity.ts                  # Symbol entity extraction (keyword map)
│   └── db/
│       └── news.ts                    # All DB queries for news_articles, polymarket_snapshots
└── types/
    └── news.ts                        # NewsArticle, SentimentLabel, PolymarketSnapshot types
```

---

## 10. UI Integration

The existing layout has a right rail. Phase 4 adds a **News** tab alongside the existing Signal Card (Phase 3):

```
Right Rail
├── [Signal Card tab]  ← Phase 3
└── [News tab]         ← Phase 4
    ├── SentimentHeatBar   (24h aggregate score for active symbol)
    ├── HourlyDigest       (collapsible — Claude paragraph)
    └── NewsFeed           (scrollable list of NewsItem cards)
        └── NewsItem
            ├── Source badge + credibility dot
            ├── Title (linked)
            ├── Author + time (relative)
            └── SentimentBadge (-0.72 · bearish)
```

**No polling jank:** `useQuery` with `staleTime: 60_000` — refetches every 60s. No WebSocket needed for news.

---

## 11. Implementation Sub-phases

| Sub-phase | Scope | Estimated complexity |
|---|---|---|
| **P4.1** | DB schema additions (`news_articles`, `polymarket_snapshots`, `nitter_accounts`) + migration | Low |
| **P4.2** | Entity extraction map + `persist.ts` dedup logic | Low |
| **P4.3** | RSS crawler (`rss.ts`) + `/api/cron/crawl-rss` (5 feeds) | Low |
| **P4.4** | Sentiment pipeline: Gemini classify + Claude summarize + `/api/cron/sentiment-run` | Medium |
| **P4.5** | Reddit crawler + OAuth client credentials flow | Medium |
| **P4.6** | Nitter RSS crawler + fallback instance handling | Medium |
| **P4.7** | Polymarket crawler + snapshots + `/api/news/polymarket` | Low |
| **P4.8** | News feed API (`/api/news/feed`) + hourly digest (`/api/news/digest`) | Medium |
| **P4.9** | UI: `NewsFeed`, `NewsItem`, `SentimentBadge`, `SentimentHeatBar`, `HourlyDigest` | Medium |
| **P4.10** | Wire into dashboard right rail; add vercel.json crons | Low |

Recommended build order: P4.1 → P4.2 → P4.3 → P4.4 (pipeline end-to-end first) → P4.8 → P4.9 → P4.5 → P4.6 → P4.7 → P4.10.

Get data flowing and visible in the UI early (after P4.4), then add sources.

---

## 12. Environment Variables

```bash
# Reddit OAuth (https://www.reddit.com/prefs/apps — create "script" app)
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=

# CryptoPanic (https://cryptopanic.com/developers/api/)
CRYPTOPANIC_API_KEY=       # free tier sufficient

# Cron security
CRON_SECRET=               # shared secret; Vercel sets this automatically

# AI (already in use)
GOOGLE_GEMINI_API_KEY=     # for sentiment classify
ANTHROPIC_API_KEY=         # for summaries + digest
```

No new paid services. Reddit and most RSS sources need no key.

---

## 13. Open Questions

1. **Nitter reliability** — public instances rotate and go down. Should we maintain a 3-instance fallback list and pick randomly, or self-host a Nitter instance on a cheap VPS?
2. **Reddit auth token caching** — the OAuth `client_credentials` token lasts 1 hour. Cache in a module-level variable (works fine for a single-server Next.js deployment) or store in Redis/DB?
3. **Hourly digest cost** — Claude called once per symbol per 30 min when someone opens the news tab. With ~27 symbols (20 crypto + 7 stocks), worst case is ~54 Claude calls/hour. Fine for personal use, but worth adding a "generate on demand" button rather than auto-generating for all symbols.
4. **CryptoPanic free tier limit** — 50 req/hr. With a 15-min crawl interval that's 4 calls/hr — well within limit. But if we add per-symbol filtering calls, we may need to batch.
5. **Body storage** — store only the first 500 chars of article body (enough for sentiment + summary). Never store full HTML. Confirm this is sufficient for Gemini to classify accurately.
