# RMC — Crypto & Stock Intelligence Platform

RMC is a personal market intelligence dashboard tracking **top-20 crypto** (dynamic, fetched from Binance)
and **Mag7 stocks** (AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA).
Goal: real-time prices, charts, technical indicators, AI analysis, strategy backtesting, and news signals — in one terminal-style interface.

> **Status:** Phase 1 complete. Working on Phase 2 (strategy builder + backtester).

---

## 🎯 Project Goals & Non-Goals

**Goals**
- Unified dashboard for crypto + Mag7 stocks
- Real-time price tracking via Binance WebSocket
- Technical indicators shareable between chart UI and backtester
- AI chart analysis (Claude for vision/reasoning, Gemini for bulk tasks)
- Strategy builder + paper trading engine (paper only — never real trades)
- News & social sentiment ingestion

**Non-Goals (do not build)**
- Wallet integration / private key handling
- Live trade execution (paper trading only)
- Smart contract development
- Custodial features
- Multi-user / SaaS features

---

## 🧱 Tech Stack

| Layer         | Choice                      | Notes                                              |
|---------------|-----------------------------|----------------------------------------------------|
| Framework     | Next.js 15 (App Router)     | React 19, Server Components by default             |
| Language      | TypeScript 5.7              | `strict: true`, no `any`                           |
| Styling       | Tailwind CSS 3.4            | No CSS files, no CSS-in-JS                         |
| UI Primitives | shadcn/ui                   | Copy-in components, customize freely               |
| Charts        | Lightweight Charts 4.2      | TradingView lib for price/candle rendering         |
| Non-price viz | Recharts 2.13               | Equity curves, volume bars, indicator subcharts    |
| State         | Zustand 5                   | Client state (active symbol, timeframe, indicators)|
| Data Fetching | TanStack Query 5.62         | Server state, caching, refetch                     |
| Backend       | Next.js API routes          | Server-side proxying; never expose API keys client-side |
| Database      | PostgreSQL + TimescaleDB    | Candles as hypertable; self-hosted via Docker      |
| DB Client     | `pg` 8.13                   | Direct Postgres — no ORM                          |
| Utils         | date-fns 4, clsx, tailwind-merge | Standard helpers                              |
| Deployment    | Vercel (web) + Docker (DB)  | Neon/Supabase Postgres for hosted option           |

**No auth yet** — single-user personal tool; add env-var gate or Auth.js later if needed.

---

## 📊 Data Sources

| Data          | Provider          | Tier          | Notes                                   |
|---------------|-------------------|---------------|-----------------------------------------|
| Crypto OHLCV  | Binance REST + WS | Free, no key  | Primary; 1000-bar pages, 300ms throttle |
| Crypto prices | Binance miniTicker| Free, no key  | Live tick for watchlist                 |
| Stock prices  | TBD               | —             | Yahoo Finance (unofficial) or Polygon   |
| News          | TBD               | —             | CryptoPanic / NewsAPI planned           |

**Rules:**
- All API keys in `.env.local` — never commit
- Always proxy through `/app/api/*` (never call third-party APIs from client)
- Cache with TanStack Query; Binance free = no rate limit on public endpoints but be courteous

---

## 📁 Project Structure (actual, Phase 1)

```
src/
├── app/
│   ├── api/
│   │   ├── candles/route.ts      # GET /api/candles?symbol=&tf=&limit=
│   │   └── symbols/route.ts      # GET /api/symbols (syncs DB from Binance)
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                  # Main dashboard page
│   └── providers.tsx             # TanStack Query provider
├── components/
│   ├── chart/
│   │   ├── ChartLayout.tsx       # Multi-pane layout (main + subcharts)
│   │   ├── PriceChart.tsx        # Lightweight Charts candlestick
│   │   └── SubChart.tsx          # Indicator subchart (RSI, MACD, etc.)
│   ├── ui/
│   │   ├── IndicatorSelector.tsx # Toggle/configure indicators
│   │   ├── StaleDataBanner.tsx   # Shown when feed is down or data is old
│   │   └── TimeframeSelector.tsx # 1m → 1W switcher
│   └── watchlist/
│       └── Watchlist.tsx         # Live price list with WebSocket ticks
├── hooks/
│   ├── useCandles.ts             # TanStack Query fetcher for OHLCV
│   └── useLiveTick.ts            # Binance WebSocket subscription hook
├── lib/
│   ├── db/
│   │   ├── client.ts             # Postgres pool (server-side only)
│   │   ├── migrate.ts            # Run schema.sql via tsx
│   │   └── schema.sql            # Full DB schema (see below)
│   ├── exchange/
│   │   ├── binance.ts            # fetchKlines, backfillKlines, subscribeKline, subscribeTicker
│   │   └── types.ts              # Raw Binance API shapes
│   └── indicators/
│       ├── index.ts              # INDICATORS registry + re-exports
│       ├── types.ts              # Indicator<P> interface
│       ├── ema.ts                # Exponential Moving Average
│       ├── sma.ts                # Simple Moving Average
│       ├── rsi.ts                # Relative Strength Index
│       ├── macd.ts               # MACD (line, signal, histogram)
│       └── bollinger.ts          # Bollinger Bands
├── store/
│   └── chart.ts                  # Zustand: activeSymbol, timeframe, indicators
└── types/
    └── market.ts                 # Candle, Timeframe, Asset shared types
```

---

## 🗄️ Database Schema

**Tables:**
- `symbols` — universe of tradeable symbols (source: binance | equities), synced on startup
- `candles` — TimescaleDB hypertable, partitioned by `open_time` in 7-day chunks; PK is `(symbol, timeframe, open_time)`
- `backfill_status` — tracks earliest/latest candle per `(symbol, timeframe)` so we never double-fetch

**Index:** `candles_sym_tf_time` on `(symbol, timeframe, open_time DESC)` — covers the most common query.

---

## 💻 Commands

```bash
pnpm dev         # local dev server (Next.js)
pnpm build       # production build
pnpm typecheck   # tsc --noEmit
pnpm migrate     # run DB migrations (tsx src/lib/db/migrate.ts)
```

Docker (DB):
```bash
docker compose up -d   # starts TimescaleDB on localhost:5432
```

---

## 🎨 Code Style

- **Components:** named exports, PascalCase, one per file
- **Hooks:** `use` prefix, named exports
- **Server Components by default** — opt into `"use client"` only when needed (hooks, WebSocket, event handlers)
- **No default exports** except Next.js `page.tsx` and `layout.tsx`
- **Imports:** absolute paths via `@/`, sorted: react → next → external → internal
- **Functions:** arrow functions for components, `function` keyword for pure utilities
- **Errors:** never swallow; always throw or surface to user via error state
- Run `pnpm typecheck` before considering any task done (no eslint config yet)

---

## 📐 Conventions

- **Money/prices:** `number` (float) from Binance; format only at display layer
- **Dates:** timestamps as Unix ms (`number`) internally; ISO 8601 when stored; `date-fns` for display
- **Symbols:** uppercase (`BTCUSDT`, `AAPL`); never mix case
- **Timeframes:** internal keys are `'1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '1w'`
- **Loading states:** every async UI must have explicit loading + error + empty states
- **Indicator interface:** `compute(candles: Candle[], params: P): IndicatorResult` — same function used by chart overlay and backtester

---

## 🗺️ Roadmap

| Phase | Status      | Scope                                                          |
|-------|-------------|----------------------------------------------------------------|
| 1     | ✅ Complete | Next.js scaffold, Binance data, TimescaleDB, chart + indicators|
| 2     | 🔄 Next     | Strategy builder, backtester, paper-trade engine               |
| 3     | Planned     | AI chart analysis (Claude vision) + numeric prediction         |
| 4     | Planned     | News/social ingestion + sentiment                              |
| 5     | Planned     | Alerts (Telegram), polish, mobile read-only view               |

---

## ⚠️ Gotchas & Tribal Knowledge

- Binance public REST has no auth requirement but rate-limits at ~1200 req/min weight; `backfillKlines` uses 300ms pause between pages
- WebSocket auto-reconnects on unexpected close (2s delay) — don't double-subscribe
- `volume` stored as **quote asset volume** (e.g. USDT amount), not base volume — more useful for USD-denominated analysis
- TimescaleDB `create_hypertable` must run before any data insert; migration is idempotent (`IF NOT EXISTS`)
- Stock markets close on weekends — UI should show "Market Closed" not stale prices; crypto is 24/7
- Mag7 = AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA (always this exact list)
- No eslint config yet — `pnpm typecheck` is the only automated check

---

## 🤖 Working With Claude

- "The dashboard" = the main `/` route (currently `src/app/page.tsx`)
- "An asset" = either a crypto symbol or a stock — the abstraction must handle both
- "Indicator" = must implement `Indicator<P>` from `src/lib/indicators/types.ts`; register in `index.ts`
- Prefer 1–2 clarifying questions over guessing when requirements are ambiguous
- Paper trading only — never build any path toward live execution
- **Keep `docs/overview.md` current:** after adding or changing a feature (new API route, indicator, page, crawler, DB table, etc.), update the relevant parts of `docs/overview.md` in the same session — status table, feature areas, architecture diagram, DB table list

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Global Agent Rules

- **Artifact Diffing:** Treat all `.md` files as standard source code. Do not silently overwrite Markdown files. You must generate and present a standard Code Diff for my review before applying any changes to documentation or plans.

## 1. Clean Code & Architecture

* **Philosophy:** Prioritize readability and maintainability over clever "one-liners."
* **SOLID:** Strictly follow Single Responsibility and Dependency Inversion.
* **DRY:** Extract common logic into reusable modules immediately upon detection.
* **Naming:** Use descriptive, self-documenting variable and function names.

## 2. Safety & Security Protocol

* **Boundary:** Never modify files outside the workspace root.
* **Credentials:** Forbidden from hardcoding API keys or secrets. Check `.env.example` for required variables.
* **Restricted Commands:** You MUST request manual user confirmation (`ASK_USER`) before executing `sudo`, `rm`, or system-level configuration changes.

## 3. Project Organization

* **Modularity:** Core logic must reside in dedicated files (e.g., `services/`, `utils/`).
* **Entry Points:** Main files (e.g., `index.ts`, `main.py`) should only act as orchestrators, calling external logic.
* **Type Safety:** Use strict typing for all TypeScript and Python (Type Hints) tasks.

## 4. Operational Standards

* **Error Handling:** Implement robust logging with stable message strings for observability.
* **Paths:** Always use absolute paths for file operations to prevent execution errors in subdirectories.
* **Style Guides:** Follow [PEP 8](https://peps.python.org) for Python and [Google&#39;s Style Guide](https://google.github.io) for TypeScript.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 5. Think Before Coding

[](https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md#1-think-before-coding)

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

* State your assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them - don't pick silently.
* If a simpler approach exists, say so. Push back when warranted.
* If something is unclear, stop. Name what's confusing. Ask.

## 6. Simplicity First

[](https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md#2-simplicity-first)

**Minimum code that solves the problem. Nothing speculative.**

* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 7. Surgical Changes

[](https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md#3-surgical-changes)

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

* Remove imports/variables/functions that YOUR changes made unused.
* Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 8. Goal-Driven Execution

[](https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md#4-goal-driven-execution)

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

* "Add validation" → "Write tests for invalid inputs, then make them pass"
* "Fix the bug" → "Write a test that reproduces it, then make it pass"
* "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.