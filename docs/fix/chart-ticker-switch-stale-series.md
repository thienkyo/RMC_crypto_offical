# Chart ticker switch — stale series / wrong scale

> Status: plan locked 2026-09-17 (Kyo / Vader)
> Repo: thienkyo/RMC_crypto_offical
> Owners: Remy (PO) → Steve (impl) → Rosa (QA) → Vader
> Scope: bugfix plan only — no implementation in this PR

## Symptom

When switching watchlist ticker (e.g. BTC → PAXG), header/watchlist update to the new symbol (~PAXG price) but the candlestick series and Y-axis stay on the previous symbol (~BTC scale). Overlay BB/EMA can appear as flat lines near the bottom.

## Root cause

Race that poisons PriceChart’s context guard:

1. Watchlist click only `setSymbol` — does not clear candles (`Watchlist.tsx` / chart store).
2. `useCandles` keeps previous series via `keepPreviousData`.
3. `ChartLayout` rebinds WS `subscribeKline` and applies ticks with `updateCandle` / `updateLastCandle` while store candles are still the old symbol.
4. `PriceChart` treats mutated array as new context data, `setData` on mostly-old OHLC, commits `loadedKeyRef`.
5. When real new-symbol fetch lands, same-context dirty check (length + last `openTime`) often matches across symbols → `setData` skipped. Overlays recompute from new Zustand candles onto old candle series/scale.

Key files:

- `src/components/chart/ChartLayout.tsx`
- `src/components/chart/PriceChart.tsx`
- `src/hooks/useCandles.ts`
- `src/store/chart.ts`
- watchlist `setSymbol` path (`src/components/watchlist/Watchlist.tsx`)
- Binance `subscribeKline` (`src/lib/exchange/binance.ts`)

## Fix plan

1. On symbol (and ideally TF) change: clear candles / live candle state in the store so WS cannot merge into the previous symbol’s series.
2. Gate WS surgical updates until candles for the current symbol+timeframe have loaded (generation/epoch or empty-candles gate).
3. In `PriceChart`, on `contextKey` change: reset `loadedKeyRef` / clear candle series immediately; only commit the new key after `setData` of fresh history; don’t treat WS-mutated previous arrays as new-context data.
4. Tighten same-context dirty check beyond length/last `openTime` (e.g. first-bar `openTime`, or stamp symbol on candle payload).
5. Narrow or drop `keepPreviousData` for symbol switches (optional keep for TF-only).

## Acceptance

- After BTC↔PAXG (and BTC↔ETH): candle closes ≈ header price; Y-axis fits new range; BB/EMA hug price (not pinned to bottom); no stale WS ticks from prior symbol.
- Rapid clicks and TF change on same symbol behave correctly.
- Brief empty flash on clear is OK.

## Test notes

BTC↔PAXG, BTC↔ETH, rapid clicks, TF change, slow/offline `/api/candles`. Watch live tick jank / existing LWC sync guards.

## Out of scope

Equities provider, hobby deploy, merge without Kyo, unrelated refactors.
