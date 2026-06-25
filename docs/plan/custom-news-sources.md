# Plan: Custom News Sources

> Status: planned — not yet implemented
> Date: 2026-06-12

Add a **"Custom" section** to the chart page's right rail (news panel) that shows
articles from a user-configured list of URLs. The list is managed on the Settings
page; every URL has a **Test button** that verifies news data can actually be
extracted from it. The crawler fetches the **4 latest items per URL**.

Decisions made:
- **URL types:** RSS/Atom feeds + auto-discovery + HTML link extraction fallback
  (user can paste a plain news homepage; the bot finds the latest article links).
- **Filtering:** the Custom rail section is **not** filtered by the active chart
  symbol — it always shows the latest items from the hand-picked sources.
  Articles still get symbol-tagged and sentiment-classified in the background.

---

## How it crawls (3-tier resolution per URL)

1. **Direct RSS/Atom** — URL response is XML → parse with the existing RSS parser.
2. **Auto-discover** — response is HTML → look for
   `<link rel="alternate" type="application/rss+xml">` in the `<head>`, fetch that
   feed instead. The resolved feed URL is cached in DB so discovery doesn't re-run
   on every crawl.
3. **HTML link extraction** — no feed found → heuristically extract article links
   from the page itself: scan `<a>` tags, keep same-domain links with
   headline-like text (length, URL patterns like `/news/`, `/article/`, dates in
   path), dedupe, take the top 4 in page order.

In all tiers the crawler keeps only the **4 latest items** per feed. For tier 3
there is no pub date, so `published_at` = first-seen time; URL-based dedup
(existing `ON CONFLICT (source, external_id)`) ensures only genuinely new links
insert.

Known limitation: tier-3 extraction is heuristic — heavily JS-rendered sites
(no server-side HTML) will yield nothing. The Test button surfaces this upfront.

---

## 1. Database — `src/lib/db/schema.sql`

New table (idempotent, follows the `nitter_accounts` pattern):

```sql
custom_news_feeds
  id                UUID PK DEFAULT gen_random_uuid()
  name              TEXT
  url               TEXT UNIQUE NOT NULL
  resolved_feed_url TEXT            -- set by Test/first crawl (tier 2)
  mode              TEXT            -- 'rss' | 'discovered' | 'html', set by Test/first crawl
  active            BOOLEAN NOT NULL DEFAULT TRUE
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Articles go into the **existing `news_articles`** table with:
- `source = 'custom'`
- `author` = feed name (so the UI can show which source an item came from)

Add `custom: 0.8` to `SOURCE_CREDIBILITY` in `src/lib/crawlers/types.ts`.

**No new article table** → symbol tagging, dedup, and the every-5-min sentiment
cron all work on custom articles for free.

## 2. Crawler — `src/lib/crawlers/custom.ts` (+ small refactor)

- Refactor `src/lib/crawlers/rss.ts` to export its internal parsing helpers
  (`extractTag`, `splitItems`, `parseItem`) for reuse.
- `resolveFeed(url)` — implements the 3-tier detection above.
- `extractArticleLinks(html, baseUrl)` — tier-3 heuristic extractor.
- `CustomCrawler implements Crawler` — same contract as every other source.
- `testFeed(url)` — shared by the Test button and nothing else; returns
  `{ ok, mode, itemCount, sampleTitles[3], error? }`, persists nothing.

## 3. API routes

| Route | Purpose |
|---|---|
| `GET/POST /api/news/custom-feeds` | list / add feed |
| `PATCH/DELETE /api/news/custom-feeds/[id]` | toggle active / remove |
| `POST /api/news/custom-feeds/test` | the **Test button** — `{url}` in, test result out, no DB writes |
| `GET /api/news/custom` | latest custom articles for the rail section, **no symbol filter**, 4 per feed |
| `GET/POST /api/cron/crawl-custom` | cron crawl, `*/15 min`, cron-auth gated like the others |

Plus:
- New cron entry in `vercel.json` (`/api/cron/crawl-custom`, `*/15 * * * *`).
- Wire custom feeds into the existing manual `/api/news/refresh` pipeline so the
  ↻ Refresh button also crawls them.
- New DB helpers in `src/lib/db/news.ts`: `getCustomFeeds`,
  `getLatestCustomArticles`.

## 4. Settings page — new "Custom News Sources" section

New `CustomFeedsSection.tsx` in `src/components/settings/`, rendered on the
settings page below the Telegram form. CRUD is immediate per-row, so it does
**not** share the existing form's Save button.

```
Custom News Sources
┌──────────────────────────────────────────────────────────────────────────────┐
│ CoinJournal   https://coinjournal.net      [Test] [✓ RSS · 20 items] [On] [✕] │
│ My blog       https://example.com/news     [Test] [✗ No feed/links found] [On] [✕] │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ name (optional) ] [ https://… ]  [Test] [+ Add]                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

Test button behaviour: spinner → green `✓ rss/discovered/html · N items` with
2–3 sample titles below (sanity-check that real headlines were grabbed), or a
red error message. When the feed is already saved, a successful Test also writes
`mode` / `resolved_feed_url` back to the row.

## 5. Chart right rail — "Custom" section in `NewsFeed.tsx`

- New `CustomNewsSection.tsx` collapsible (same pattern as `HourlyDigest`),
  placed between the digest and the main article list.
- Fetches via a new `useCustomNews()` hook (60s poll, same style as
  `useNewsFeed.ts`), query key `['news-custom']`.
- Reuses `NewsItem` for rendering — custom articles get sentiment badges
  automatically once the cron classifies them.
- Empty state links to `/settings` ("No custom sources — add one in Settings").
- The ↻ Refresh button additionally invalidates `['news-custom']`.

## 6. Verification

1. `pnpm migrate`
2. `pnpm typecheck`
3. Manual test: add a real feed URL (one RSS case + one plain-HTML case), hit
   Test, trigger ↻ Refresh, confirm 4 items appear in the rail and get
   classified by the sentiment cron.

---

## Touched files

**New (~6):**
- `src/lib/crawlers/custom.ts`
- `src/app/api/news/custom-feeds/route.ts`
- `src/app/api/news/custom-feeds/[id]/route.ts`
- `src/app/api/news/custom-feeds/test/route.ts`
- `src/app/api/news/custom/route.ts`
- `src/app/api/cron/crawl-custom/route.ts`
- `src/components/settings/CustomFeedsSection.tsx`
- `src/components/news/CustomNewsSection.tsx`
- `useCustomNews` hook (in `src/hooks/`)

**Edited (~7):**
- `src/lib/db/schema.sql`
- `src/lib/crawlers/types.ts`
- `src/lib/crawlers/rss.ts` (export parse helpers)
- `src/lib/db/news.ts`
- `src/app/api/news/refresh/route.ts`
- `src/components/news/NewsFeed.tsx`
- `vercel.json`
- settings `page.tsx`
