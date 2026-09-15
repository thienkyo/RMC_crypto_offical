# RMC — Crypto & Market Intelligence Dashboard

A personal, single-user market intelligence terminal: live crypto prices, candlestick charts with
37 built-in indicators and candle patterns, a visual strategy builder with backtesting, AI chart analysis,
a news/sentiment pipeline, and Telegram alerts — all in one Next.js app.

> **Paper trading only.** No wallets, no private keys, no live order execution — by design, and never.

---

## Quick start

**Prerequisites:** Node.js 22+, Docker Desktop.

```bash
npm install
docker compose up -d        # TimescaleDB on localhost:5432 (wait ~10s for "healthy")
# create .env.local — see "Environment" below
npm run migrate             # apply src/lib/db/schema.sql
npm run dev                 # → http://localhost:7070
```

Open **http://localhost:7070**. On first load you should see the watchlist populate, the BTCUSDT 1h
chart backfill from Binance (a one-time fetch, then cached in Postgres), and live ticks arriving over
the Binance WebSocket within a few seconds.

### Environment

There is no `.env.local.example` in the repo (it is gitignored). Create `.env.local` by hand:

```bash
# ─── Required ───────────────────────────────────────────────────────────────
# Matches docker-compose.yml for local dev
DATABASE_URL=postgres://rmc:rmc_dev_password@localhost:5432/rmc_crypto

# AI chart analysis + news sentiment classification
GEMINI_API_KEY=

# ─── Feature-specific ───────────────────────────────────────────────────────
# Telegram alerts. The bot token lives here; the destination chat IDs are
# stored in the `settings` table and edited at /settings — not in env.
TELEGRAM_BOT_TOKEN=

# Reddit crawler — create a "script" app at https://www.reddit.com/prefs/apps
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=

# Optional: Claude is preferred for article summaries and the hourly digest.
# Without it both fall back to Gemini.
ANTHROPIC_API_KEY=

# Production only — Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
# When unset, cron auth is skipped (intended for local dev).
CRON_SECRET=
```

Hosted Postgres (Neon/Supabase) needs `?sslmode=require` on `DATABASE_URL` — the pool enables SSL
based on that substring.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port **7070** (not 3000) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` — **the only automated check** (no eslint config yet) |
| `npm run migrate` | Apply `src/lib/db/schema.sql` (idempotent) |
| `npm run restart` | `./updateCode.sh -f` — force install + build + migrate + restart |
| `npm run updateCode` | Same script, but only acts when git has changes (`-h` for flags) |

Run `npm run typecheck` before considering any change done.

---

## What's in it

### 📈 Dashboard (`/`)
Multi-pane chart layout — candlestick main chart (Lightweight Charts) plus indicator subcharts,
a live watchlist fed by the Binance miniTicker WebSocket, timeframes from `1m` to `1w`, a candle
countdown timer, and a stale-data banner when the feed drops.

### 🧮 Indicators & patterns (`src/lib/indicators/`, `src/lib/patterns/`)
37 entries in the `INDICATORS` registry, all implementing one `Indicator<P>` interface — so the
**same `compute()` function** backs both chart overlays and the backtester.

- *Classic:* EMA, SMA, RSI, MACD, Bollinger Bands (+ %B, width), ADX, Stochastic, StochRSI
- *Volume/flow:* volume profile, volume ratio, CVD, CVD divergence, absorption
- *Contextual:* EMA deviation, time-of-day
- *Candle patterns:* engulfing, hammer/shooting star, doji stars, abandoned baby, belt hold,
  breakaway, advance block, three white soldiers, identical three crows, fair value gaps,
  liquidity sweeps

### 🧪 Strategy builder & backtester (`/strategy`)
Visual condition-group builder, strategies stored with full version history, backtest metrics with
an equity curve and a strategy rating, plus live signal evaluation that notifies over Telegram.
Starter templates cover common setups.

### 🤖 AI chart analysis
Gemini-backed analysis of the current chart via `/api/ai/chart-analysis`; results persist in
`ai_chart_analysis`.

### 📰 News & sentiment (`src/lib/crawlers/`, `src/lib/sentiment/`)
Cron-driven crawlers for RSS (CoinDesk, CoinTelegraph, Decrypt, The Block, BeInCrypto), Reddit,
Nitter/X analyst accounts, and Polymarket odds. Gemini batch-classifies sentiment; article summaries
and the hourly digest prefer Claude and fall back to Gemini. The feed and digest are exposed under
`/api/news/*`, with a manual `/api/news/refresh` trigger.

### 🔔 Alerts & settings
User-defined alert rules evaluated every minute by the `check-alerts` cron and delivered via
Telegram (history in `alert_history`). Routing is split between personal and group chats, whose IDs
— along with the rest of the app's settings — live in the `settings` table and are edited at
`/settings`.

---

## Architecture

```
Binance REST ──► /api/candles ──► TimescaleDB ──► TanStack Query ──► chart
Binance WS  ─────────────────────────────────────────────────────► watchlist (client-only)
RSS/Reddit/Nitter/Polymarket ──► /api/cron/* ──► DB ──► Gemini ──► /api/news/*
alert rules + strategy signals ──► check-alerts cron ──► Telegram
```

- Every third-party call is proxied through `/app/api/*` — **API keys never reach the client**.
  The one exception is the keyless Binance WebSocket, which runs in the browser.
- `src/app/page.tsx` is a Server Component; `ChartLayout` is dynamically imported with `ssr: false`
  so canvas/WebSocket APIs never execute server-side.
- Candles live in a TimescaleDB hypertable partitioned by `open_time` in 7-day chunks,
  PK `(symbol, timeframe, open_time)`. `backfill_status` tracks earliest/latest per
  `(symbol, timeframe)` so history is never fetched twice.

### Project layout

```
src/
├── app/
│   ├── api/            # candles · symbols · strategies · ai · news · alerts · settings · cron/*
│   ├── page.tsx        # dashboard
│   ├── strategy/       # strategy builder + backtester page
│   └── settings/       # settings page
├── components/         # chart · watchlist · strategy · news · alerts · analysis · ui
├── hooks/              # useCandles · useLiveTick · useBacktest · useNewsFeed · useAlertPoller · …
├── lib/
│   ├── ai/             # Gemini client + prompts
│   ├── alerts/         # alert-rule evaluation
│   ├── crawlers/       # rss · reddit · nitter · polymarket · cron-auth
│   ├── db/             # pg pool (server-only) · migrate · schema.sql
│   ├── exchange/       # Binance REST + WebSocket
│   ├── indicators/     # Indicator<P> implementations + INDICATORS registry
│   ├── patterns/       # candlestick / price-action patterns
│   ├── sentiment/      # classify · summarize · digest · entity
│   ├── strategy/       # backtester · evaluate · metrics · signals · rating
│   └── telegram.ts     # bot delivery + chat routing
├── store/              # Zustand: chart · layout · strategy · watchlist
└── types/              # shared Candle, Timeframe, MarketSymbol
```

### Database

13 tables: `symbols`, `candles` (hypertable), `backfill_status`, `strategies`, `strategy_versions`,
`strategy_signals`, `ai_chart_analysis`, `news_articles`, `nitter_accounts`, `polymarket_snapshots`,
`alert_rules`, `alert_history`, `settings`. Full DDL in
[src/lib/db/schema.sql](src/lib/db/schema.sql).

### Scheduled jobs

Configured in [vercel.json](vercel.json):

| Path | Schedule |
|---|---|
| `/api/cron/crawl-rss` | every 15 min |
| `/api/cron/crawl-reddit` | every 30 min |
| `/api/cron/crawl-nitter` | every 20 min |
| `/api/cron/crawl-polymarket` | every 10 min |
| `/api/cron/sentiment-run` | every 5 min |
| `/api/cron/check-alerts` | every minute |

---

## Adding an indicator

1. Create `src/lib/indicators/myIndicator.ts` implementing `Indicator<P>` from
   [src/lib/indicators/types.ts](src/lib/indicators/types.ts) — including an `id` field.
2. Import it in [src/lib/indicators/index.ts](src/lib/indicators/index.ts) and add
   `[myIndicator.id]: myIndicator` to the `INDICATORS` map.

It then appears in the indicator selector and becomes usable in strategies automatically — the
registry is keyed by each indicator's own `id`, so store lookups resolve regardless of import name.

---

## Gotchas

- **Port is 7070**, not Next's default 3000.
- `volume` is stored as **quote-asset volume** (USDT), not base volume — more useful for
  USD-denominated analysis.
- Binance public REST rate-limits at ~1200 req/min weight; `backfillKlines` pauses 300 ms between
  1000-bar pages.
- The WebSocket auto-reconnects 2s after an unexpected close — don't double-subscribe.
- TimescaleDB's `create_hypertable` must run before any insert; the migration is idempotent.
- The `pg` pool is stashed on `globalThis` so Next.js HMR doesn't exhaust connections in dev.
- **Stocks are symbol-level only.** Mag7 (AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA) is seeded into
  `symbols` with `source: 'equities'`, but no price provider is wired in — `/api/candles` is
  Binance-only, so crypto is the live data source today.
- No auth. `APP_PASSWORD` exists in env but nothing reads it — treat this as a local, single-user app.

---

## Deploying

1. Push to GitHub, create a Neon/Supabase Postgres.
2. Set `DATABASE_URL` (with `?sslmode=require`), `GEMINI_API_KEY`, `CRON_SECRET`, and any
   feature keys you use (`TELEGRAM_BOT_TOKEN`, `REDDIT_CLIENT_*`, `ANTHROPIC_API_KEY`) in Vercel.
3. Deploy — `npm run build` runs automatically; Vercel picks up the crons from `vercel.json`.
4. Run the migration once against the production database.

---

## More docs

- [docs/overview.md](docs/overview.md) — architecture deep-dive with diagrams and phase status
- [CLAUDE.md](CLAUDE.md) — code style, conventions, and tribal knowledge
- [SETUP.md](SETUP.md) — original Phase 1 setup walkthrough (partly out of date)
- [PHASE4_PLAN.md](PHASE4_PLAN.md) — news/sentiment design notes
