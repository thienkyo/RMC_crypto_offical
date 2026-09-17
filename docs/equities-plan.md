# Equities Plan — US stocks in RMC

> **Status:** locked product plan (Kyo / Remy / Vader) — **not implemented**
> **Date:** 2026-09-17
> **This PR:** docs only. Do not implement providers. Do not merge or deploy without Kyo.

RMC is **crypto-first** (Binance). A Mag7 watchlist section and `source: 'equities'` types already exist, but equities do not work. This document is the locked plan for making real US-listed stocks first-class for **watch and research only**.

---

## Problem (today)

Candles, live ticks, and symbol validate are **Binance-only**. Selecting Mag7 (e.g. `AAPL`) fails, returns empty/stale data, or **coerces the ticker to `AAPLUSDT`**.

What the code does now:

| Surface | Current behavior |
|---------|------------------|
| Watchlist Mag7 | Seeded in `/api/symbols` as `source: 'equities'` (`AAPL`, `MSFT`, `NVDA`, `GOOGL`, `AMZN`, `META`, `TSLA`) |
| `/api/candles` | Always `fetchKlines` / Binance backfill. No source branch. |
| Chart live ticks | `subscribeKline` to Binance for whatever `activeSymbol` is |
| Watchlist ticks | `subscribeTicker` only for `source === 'binance'` — Mag7 never ticks |
| `/api/symbols/validate` | `normalize()` appends `USDT` to bare tickers (`AAPL` → `AAPLUSDT`) and checks Binance 24h ticker |
| Custom add | Same validate path, so adding `AAPL` tries Binance |
| Persistence | `symbols.source` exists (`binance` \| `equities`). `candles` PK is `(symbol, timeframe, open_time)` with **no provider/source column** |

Crypto via Binance stays the live path. Equities are UI scaffolding only.

---

## Goals

1. **Real US equity OHLCV + quotes** for listed cash stocks (NYSE / Nasdaq truth).
2. **Source routing** on `binance | equities` so crypto and stocks never share a fetch path.
3. **US market hours + baskets** so the UI behaves like a stock terminal, not a 24/7 crypto feed.

---

## Non-goals

Do **not** build:

- Live stock execution, broker login, or any path toward real orders (paper only, same as crypto).
- Treating **RWA / tokenized stocks / Hyperliquid equity perps** as Mag7 NYSE charts.
- Mixing equities into **Pinky crypto grades** (Pinky stays crypto-only).
- Hobby deploy or merge of this work **without Kyo**.

RWA / tokenized / perp equity products are a later, **separate source** (see P3) — never aliases of Mag7 cash marks.

---

## Locked defaults

These are decided. Do not re-litigate in implementation PRs.

| Decision | Lock |
|----------|------|
| Marks | **NYSE-truth** cash-equity marks. Charts and quotes represent the US listed share, not a token or perp. |
| Primary provider | **Polygon** |
| Hobby fallback | **Yahoo-class** unofficial feed is OK when Polygon is unavailable / unset (local hobby only) |
| Crypto | **Binance stays** the crypto source. Do not route `BTCUSDT` through Polygon/Yahoo. |
| Mag7 basket | Always exactly `AAPL`, `MSFT`, `NVDA`, `GOOGL`, `AMZN`, `META`, `TSLA` |
| AI / AI-infra starters | `NVDA`, `AVGO`, `AMD`, `TSM`, `ASML`, `MU`, `WDC`, `STX`, `SMCI`, `ARM`, `PLTR` |
| Symbol identity | Equity tickers stay exchange-native (`AAPL`). **Never** `AAPLUSDT`. |
| Persistence | Store candles/quotes with a **clear source** (provider + `equities` vs `binance`) so feeds cannot mix |

---

## Constraint — Vietnam / watch-only

Kyo is **outside the USA**. Real share purchases go through a **VN broker, outside RMC**.

RMC is **watch and research only** for equities: charts, quotes, hours, baskets, later paper strategies and alerts. No broker adapter, no live stock orders, no “place order on VN broker from RMC.”

---

## Three-stage technical fix

Implement in this order. Later stages assume earlier ones.

### Stage 1 — Provider

- Add an equities market-data client. **Polygon is default.**
- Yahoo-class hobby fallback is allowed when Polygon is not configured.
- Keep Binance for crypto. Do not replace or wrap Binance with the stock client.
- Normalize Polygon (and fallback) bars/quotes onto the existing `Candle` / `Ticker` shapes.
- Persist with a **clear source**: which universe (`equities`) and which provider (`polygon` \| `yahoo` or equivalent) produced the row. Do not silently overwrite Binance bars, and do not mix Polygon and Yahoo into the same `(symbol, timeframe)` history without recording the provider.

### Stage 2 — Source routing

Branch **candles, live ticks, and validate** on `source`:

- `binance` → existing Binance REST + WebSocket (unchanged for crypto).
- `equities` → Polygon (or Yahoo fallback). Regular-session OHLCV + quotes.

Hard rules:

- `AAPL` stays `AAPL`. Validate must **not** append `USDT` to equities.
- Never coerce Mag7 (or any US ticker) to `AAPLUSDT` / `*USDT`.
- Custom-add / search must resolve `AAPL` as `source: 'equities'` (or fail closed), not as a Binance pair.
- Chart kline subscribe and watchlist ticker subscribe must pick the feed from `MarketSymbol.source`, not from “looks like a ticker.”

### Stage 3 — Stock behavior

- **RTH (regular trading hours)** as the default session for equity charts/quotes.
- UI must show **Market closed** when the US cash session is shut (nights, weekends, holidays) — not a stale 24/7 crypto tick. Crypto remains 24/7.
- Watchlist **baskets**:
  - **Mag7** — locked list above.
  - **AI / AI-infra** — locked starter list above.
  - Later: a **safe-risk** basket placeholder (tickers TBD; do not invent a list here).
- RWA / tokenized / HL equity perps, if ever added, are **separate sources** with their own marks — not Mag7, not NYSE-truth overlays.

---

## Delivery phases

| Phase | Scope | Maps to |
|-------|--------|---------|
| **P0** | Mag7 charts that actually work | Stages **1 + 2**. Polygon (Yahoo fallback OK). Source-routed candles, ticks, validate. `AAPL` charts as `AAPL`. |
| **P1** | Hours + baskets | Stage **3** minus later sources. RTH, Market closed, Mag7 + AI/AI-infra sections. |
| **P2** | Paper strategies + alerts on equities | Reuse existing strategy/alert engines on equity candles. **No orders.** |
| **P3** | Optional tokenized / perp | Separate sources only. Never presented as Mag7 NYSE charts. |

P0 is the first implementation PR (after this plan is reviewed). P1–P3 are follow-ons.

---

## Out of scope until a later explicit PR

- Safe-risk basket membership (placeholder only in P1).
- Extended hours / pre-post as a first-class session (RTH is the default).
- Earnings calendar, fundamentals, options.
- Mixing stock names into Pinky crypto grades or crypto-only sentiment products.
- Any deploy of equities providers to hobby/prod without Kyo’s merge.

---

## Suggested implementation map (for the P0 PR, not this one)

Sketch only — **do not land in this docs PR**.

1. `src/lib/exchange/equities.ts` (or `polygon.ts` + `yahoo.ts`) — fetch OHLCV + quotes; never called for `source: 'binance'`.
2. `/api/candles` — look up `symbols.source` (or an explicit `source=` query) and dispatch.
3. `/api/symbols/validate` — try equities (Polygon ticker snapshot / Mag7+AI lists) **before** USDT-append; Binance path only for crypto pairs / bare crypto bases.
4. Chart `subscribeKline` and watchlist `subscribeTicker` — no Binance WS for `equities`.
5. Schema: persist provider/source on candle ingest (`backfill_status` and/or a `source`/`provider` column). Do not change PK identity of `AAPL` to a USDT pair.

---

## Review gate

- This document is the contract for equities work.
- Implementation PRs must follow locked defaults above.
- **No merge and no deploy of this plan or of follow-on equities code without Kyo.**
