# Task Conversations Summary

A summary of all task conversations in the RMC Crypto project, grouped by theme.
Generated 2026-06-12.

---

## Roadmap & Feature Ideation

### improvement idea
Confirmed the roadmap stops at Phase 5 (no Phase 6). Brainstormed trading-web
improvements across several dimensions:
- **UX:** Cmd-K command palette, multi-chart grid, saved workspaces, shortcuts cheatsheet.
- **Analytics:** correlation matrix, volatility dashboard, divergence scanner, volume anomaly detection.
- **Paper-trade extensions:** trade journal, drawdown replay, slippage/fee modeling.
- **AI layer:** daily market brief, "why did this pump/dump?", AI strategy suggestions.
- **Market data:** funding rate tracker, Fear & Greed widget, Mag7 earnings calendar, BTC dominance.

Top picks called out: **trade journal** + **Cmd-K palette**. Also began designing two
Telegram message types — single indicator alert vs. full strategy signal.

### task opus 4.7 — profile, account feature
Surveyed trending mid-2026 crypto-dashboard features (liquidation heatmaps, ETF flow
tracker, correlation matrix, MCP-server wrapper), then pivoted to designing an
account/profile system. Pushed back on the "accounts" framing vs. the single-user rule,
and split the work into two phases:
- **Phase 1 — Profiles:** named config bundles, cookie-pinned active profile,
  `profiles` / `profile_settings` / `profile_watchlist` tables, no auth.
- **Phase 2 — Accounts:** real users, bcrypt passwords, sessions, middleware, admin UI.

Detailed schema, API shapes, and Next.js patterns were delivered. Planning only — no code
yet. Left ready to build, awaiting go-ahead.

---

## Phase Work (P1–P5)

### RMC P1
Fixed Telegram routing. The real send path (`lib/alerts/telegram.ts`) was reading
`TELEGRAM_CHAT_ID` from env with no routing logic, while the newly-built `lib/telegram.ts`
was unused. Rewrote it to accept a `targetName`, read chat IDs from the DB, and route by
name; updated the cron call sites and the test endpoint.

### RMC P2 — strategy
Added multi-position support (`maxPositions` field + engine logic for independent SL/TP per
position) and a strategy duplication button in the left rail.

### RMC P3 — AI analysis, prediction
Diagnosed an empty news feed: the infrastructure existed but the crawlers had never run.
Provided manual `curl` steps to seed the RSS/Reddit/Nitter crawlers in local dev, plus the
keyword-matching gotcha for symbol tagging.

### RMC P4 — trading news
Made strategy CRUD DB-first: new `DELETE /api/strategies/all` route + `lib/strategy/api.ts`
client helpers, store actions now return values to push to DB, builder hydrates from DB on
mount with localStorage fallback + offline banner, and removed the old startup sync loop.

### RMC P5 — polish, tele
Reworked strategy signal scoring/notifications: added `rating` + `entry_price_limit` DB
columns, new `signalScore` / `strategyScoreRange` functions, a richer Telegram message
layout (icons, entry price, fired-group sorting), and a star-rating range in the signal
popover.

---

## Bugs & Smaller UI Tweaks

### issue, bug
Diagnosed and fixed a chart bug where switching symbol/timeframe left stale data on screen.
Root cause was TanStack Query's `keepPreviousData` interacting with the chart's
context-commit logic. Fix tracks candle-array identity instead of `contextKey`/length to
gate redraws and autoscale.

### New feature troubleshooting
Explained a Telegram dedup commit (real root cause was dev/prod sharing one group; offered
an env-guard fix). Then added collapse/expand to strategy groups (first group open by
default, the rest collapsed) and widened the group-name field.

### Project understanding
Built an on-demand News **↻ Refresh** button (new `/api/news/refresh` route running the
full pipeline, TanStack `useMutation` + query invalidation). Then planned a **Custom news
section**: user-configured URL list in Settings, hybrid extraction (RSS auto-discovery
first, Gemini fallback for the 4 latest items), `custom_sources` table, new crawler, and a
Custom filter tab. Planning only — left ready to build.

---

## Setup & Docs

### Deploy application to another machine
Step-by-step deployment guide for both local dev (copy code, `.env.local`, Docker
TimescaleDB, migrate, dev) and production (Vercel + Neon/Supabase, with the
TimescaleDB-extension caveat), plus a full GitHub setup walkthrough.

### Check for claude.md file
Confirmed `CLAUDE.md` existence, found it stale ("Early planning phase" with TBDs), and
rewrote it to reflect the actual shipped Phase 1 state (tech stack versions, file
structure, DB schema, roadmap, gotchas).

---

## Open / Unfinished Threads
- **Custom news section** (Project understanding) — planned, awaiting build go-ahead.
- **Profiles feature** (task opus 4.7) — Phase 1 planned, awaiting build go-ahead.
