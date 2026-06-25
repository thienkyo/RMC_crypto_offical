# Plan: MTF (Multi-Timeframe) Strategies

> Status: planned — not yet implemented
> Date: 2026-06-12

Add a new **"MTF" group** to the strategy page's left rail holding manually-created
multi-timeframe strategies — e.g., enter on 1h RSI but only when the 4h trend agrees.
Includes full engine support across all four evaluation paths.

Decisions made:
- **Per-CONDITION timeframe** — each individual condition may pick its own
  (higher-than-base) timeframe via a dropdown on the condition row.
- **v1 scope: everything** — backtester + Telegram notify cron + live chart
  markers + raw chart signals all support MTF from day one.
- **Left rail:** MTF section mirrors the Strategies section (collapsible per-symbol
  sub-groups, toggle-all + clone hover actions); created via a **+ icon next to
  the "MTF" header** (sets `isMtf: true`). No templates.
- **HTF semantics:** on each base bar, an HTF condition uses the **last fully
  CLOSED** HTF candle (no lookahead bias). Lower-than-base TFs not allowed
  (intrabar ambiguity).
- **Don't touch current logic** — existing single-TF strategies must behave
  byte-for-byte identically; every change is an optional field/param.

---

## Why it's feasible

- Indicators are timeframe-agnostic pure functions (`compute(candles, params)`) —
  they work on HTF candle arrays as-is.
- All four evaluation paths share one indicator cache keyed by condition and
  looked up by base-bar `openTime` (`src/lib/strategy/evaluate.ts`). Pre-aligning
  HTF values onto base openTimes at cache-build time means the evaluators,
  backtest loop, notify logic, and signal scan all work unchanged.
- Strategies persist as JSONB blobs (DB) + zustand localStorage → new optional
  fields need **no migration**.
- `ConditionGroupEditor.tsx:46` already has an unused `isMultiTf?: boolean`
  placeholder prop documented as the future Multi-TF mode.

---

## Data model (`src/types/strategy.ts`)

```ts
export interface StrategyCondition {
  // ...existing...
  /** MTF: evaluate this condition on a higher timeframe. Undefined → strategy.timeframe.
      On each base bar, uses the last fully CLOSED candle of this timeframe. */
  timeframe?: Timeframe;
}

export interface Strategy {
  // ...existing...
  /** Created via the MTF section's + button; drives left-rail grouping + per-condition TF UI. */
  isMtf?: boolean;
}
```

Per-condition TF makes the engine change *smaller* than per-group: the cache key
is derived purely from the condition, so no parameter threading through the
evaluators is needed at all.

---

## Implementation steps

### 1. TF-aware `conditionCacheKey` (`src/lib/strategy/evaluate.ts:54`) — the ONLY evaluate.ts change

```ts
export function conditionCacheKey(c: StrategyCondition): string {
  const base = `${c.indicatorId}|${c.seriesIndex}|${JSON.stringify(c.params)}`;
  return c.timeframe ? `${c.timeframe}|${base}` : base;  // old keys byte-identical
}
```

### 2. New module `src/lib/strategy/mtf.ts` (all new logic isolated here)

Pure, client/server-safe:

- `collectHtfTimeframes(strategy): Timeframe[]` — distinct `condition.timeframe`
  across all entry+exit conditions where set and ≠ base.
- `hasHtfConditions(strategy): boolean`
- `type HtfCandleSets = Partial<Record<Timeframe, Candle[]>>`
- `buildMtfIndicatorCache(strategy, baseCandles, htfCandles)`:
  1. Partition conditions by `condition.timeframe ?? strategy.timeframe`.
  2. Base conditions → delegate to existing `buildIndicatorCache` (zero drift).
  3. HTF conditions → drop the forming HTF candle, compute the indicator over the
     HTF array, **align** onto base openTimes, store under the TF-aware key.
  4. Missing required `htfCandles[tf]` → **throw** (never swallow).

**Alignment (lookahead-safe), two-pointer O(n):** HTF candle `h` supplies the
value for base bar `b` iff `h` is the latest HTF candle with
`h.openTime + TF_TO_MS[htf] <= b.openTime + TF_TO_MS[base]`
(h closes no later than b closes). `TF_TO_MS` from `src/lib/exchange/binance.ts:17`.
Matches TradingView `lookahead_off`; the aligned series is a step function on base
bars (so `crosses_*` fires on the first base bar at/after the HTF cross, and
`confirmation N` counts base bars).

### 3. Backtester fork (`src/lib/strategy/backtester.ts` ~line 72)

- `BacktestOptions.htfCandles?: HtfCandleSets`
- ```ts
  const cache = hasHtfConditions(strategy)
    ? buildMtfIndicatorCache(strategy, candles, options.htfCandles ?? {})
    : buildIndicatorCache(allConditions, candles);  // identical old branch
  ```
- Main loop, SL/TP, limit orders, metrics untouched.

### 4. Backtest data fetch (`src/hooks/useBacktest.ts` ~42–58)

Extract the existing fetch+normalize into `fetchCandleWindow(symbol, tf)`;
`Promise.all` over base + `collectHtfTimeframes(strategy)`, each `limit=1000`
(1000 HTF bars always span more than the base window + indicator warmup);
pass `{ htfCandles }` to `runBacktest`.

### 5. Client HTF candle hook — `src/hooks/useHtfCandles.ts` (new)

`useHtfCandles(strategies): { htfCandles, isLoading }` — TanStack Query fetches
per distinct (symbol, htf) needed by the chart paths. Shared by ChartLayout +
useLiveStrategy so the two chart paths don't double-fetch.

### 6. Live chart monitor (`src/hooks/useLiveStrategy.ts`)

Pull `htfCandles` from `useHtfCandles` and pass
`runBacktest(strategy, window, { htfCandles })` (line ~85). If HTF data hasn't
loaded yet for an MTF strategy, skip that strategy this tick with a
`console.info` (re-evaluates on next bar close).

### 7. Raw chart signals (`src/lib/strategy/signals.ts:31` + `src/components/chart/ChartLayout.tsx`)

`computeSignalCandles(strategy, candles, htfCandles?)` — when the strategy has
HTF conditions, build the cache via `buildMtfIndicatorCache`; scan loop
unchanged. ChartLayout supplies `htfCandles` from `useHtfCandles`; returns `[]`
until loaded.

### 8. Telegram notify cron (`src/lib/strategy/notify.ts`, `evaluateStrategySignal` line 52)

Already fetches base candles via `fetchLatestCandles(symbol, tf, CANDLE_WINDOW)`
(DB + fresh Binance tail, line ~230). Also call it once per
`collectHtfTimeframes(strategy)` (parallel), build the cache via
`buildMtfIndicatorCache` when `hasHtfConditions`. Closed-candle filter,
dedup/stamp logic, and debug payload stay keyed on the base candle — unchanged.
The alignment rule guarantees a co-closing HTF candle is closed on Binance when
the base bar is, so live matches backtest.

### 9. UI

- **`src/store/strategy.ts`** — `createDefaultMtfStrategy()` =
  `{ ...createDefaultStrategy(), name: 'New MTF Strategy', isMtf: true }`.
  Clone/import/export spread the whole object → fields propagate for free.
- **`src/components/strategy/StrategyList.tsx`** — third section "MTF":
  - `mtfStrategies = strategies.filter(s => !s.isTemplate && s.isMtf)`; exclude
    `isMtf` from `regularStrategies` (line 674). Old strategies render exactly
    where they do today.
  - New `SectionHeader` (extend `accent` union with e.g. `'cyan'`) with
    **`onAdd` = + icon next to "MTF"** → `createDefaultMtfStrategy()` + DB push
    (mirror `handleNewStrategy`, line 691).
  - Rendering **mirrors the Strategies section**: collapsible per-symbol
    sub-groups with toggle-all (⏻) and clone-to-symbol (→) hover actions.
    Refactor the symbol-group block (~1012–1143) into a reusable local component
    parameterized by the strategy list + expand-state key prefix, used by both
    sections. Clone-to-symbol preserves `isMtf`.
- **`src/components/strategy/ConditionGroupEditor.tsx`** — implement MTF UI
  **per condition row**: when `isMultiTf` (existing placeholder prop, line 46)
  + new `baseTimeframe` prop, render a compact TF `<select>` on each condition
  row — "Base (1h)" (→ `timeframe: undefined`) + only TFs with
  `TF_TO_MS[tf] > TF_TO_MS[base]`; cyan badge when non-base.
- **`src/components/strategy/StrategyForm.tsx`** — pass
  `isMultiTf={draft.isMtf === true}` + `baseTimeframe={draft.timeframe}` to
  entry/exit editors; MTF badge in header; when the base TF changes, clear any
  `condition.timeframe` no longer strictly higher.

### Order

types → mtf.ts → evaluate.ts key → backtester → useBacktest → useHtfCandles →
useLiveStrategy → signals/ChartLayout → notify → store → ConditionGroupEditor →
StrategyForm → StrategyList. `pnpm typecheck` after each.

---

## Backward-compatibility argument

Old strategies: no `isMtf`, no `condition.timeframe` → `hasHtfConditions` false →
identical `buildIndicatorCache` branch in all four paths → `conditionCacheKey`
returns identical strings → `useBacktest`/notify fetch only the base TF →
`useHtfCandles` fetches nothing → left rail renders them in the same Strategies
section → condition rows show no TF selector. Every change is an optional
field/param defaulting to absent.

---

## Verification

1. `pnpm typecheck` after each step.
2. **Regression:** before starting, backtest an existing 1h strategy and save the
   `[Backtest]` console output (trade count, entry/exit times, `totalReturnPct`).
   Re-run after — must match exactly. Left rail: same strategies under
   "Strategies"; "MTF" section empty.
3. **MTF backtest — "1h entry with 4h filter on BTCUSDT":** via MTF + icon:
   base `1h`, entry group with `RSI(14) < 40` (base) AND `RSI(14) > 50` set to
   `4h`. Expect fewer trades than without the filter, no errors. Spot-check the
   aligned 4h series is a step function: constant across 1h bars 00/01/02, steps
   on the bar whose close coincides with the 4h close — never earlier (no lookahead).
4. **Live paths:** activate the MTF strategy on the chart → entry markers appear
   and match backtest signal bars; raw signals render; trigger the check-alerts
   cron manually (GET route) → MTF strategy evaluates without error and dedups
   on the base candle.
5. **Left rail:** MTF section groups by symbol; toggle-all and clone-to-symbol
   work; cloned strategy stays in the MTF section.
6. **Persistence:** save, reload (DB + localStorage hydrate), export/import
   JSON — `isMtf` + condition timeframes survive.

---

## Files

| File | Change |
|---|---|
| `src/types/strategy.ts` | `+condition.timeframe?`, `+strategy.isMtf?` |
| `src/lib/strategy/mtf.ts` | **new** — collect/align/MTF cache |
| `src/lib/strategy/evaluate.ts` | TF-aware `conditionCacheKey` (1 function) |
| `src/lib/strategy/backtester.ts` | `htfCandles` option + guarded cache fork |
| `src/hooks/useBacktest.ts` | parallel multi-TF fetch |
| `src/hooks/useHtfCandles.ts` | **new** — shared client HTF fetch |
| `src/hooks/useLiveStrategy.ts` | pass htfCandles; skip-until-loaded |
| `src/lib/strategy/signals.ts` | optional htfCandles param + MTF cache |
| `src/components/chart/ChartLayout.tsx` | supply htfCandles to signals |
| `src/lib/strategy/notify.ts` | fetch HTF sets server-side + MTF cache |
| `src/store/strategy.ts` | `createDefaultMtfStrategy()` |
| `src/components/strategy/StrategyList.tsx` | MTF section (symbol-grouped, + icon) |
| `src/components/strategy/ConditionGroupEditor.tsx` | per-condition TF selector |
| `src/components/strategy/StrategyForm.tsx` | props, badge, TF-change guard |
