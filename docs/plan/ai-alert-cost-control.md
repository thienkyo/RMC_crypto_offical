# Plan: AI Signal Alert Cost & Flood Control

> Status: PROPOSED — Under Review
> Date: 2026-10-03
> Author: Antigravity & Kyo

## 1. Problem Statement & Context

During sharp crypto market sell-offs or sudden rallies, market movements across crypto assets are highly correlated. When Bitcoin dumps or spikes, multiple altcoins (e.g. ETH, SOL, PAXG, etc.) satisfy entry conditions simultaneously on the same candle.

In the current architecture:
1. **Hardcoded Rating Threshold (`rating >= 4`)**: In `src/lib/strategy/rating.ts`, `AI_VERDICT_MIN_RATING = 4` is hardcoded. Any strategy reaching 4 or more stars triggers an LLM call.
2. **Uncapped Simultaneous Execution**: In `src/app/api/cron/check-alerts/route.ts`, all triggered strategies run `evaluateStrategySignal(...)` concurrently.
3. **Double Impact**:
   - **Cost Spike**: If 20 strategies fire on the same candle, 20 distinct LLM calls (Gemini/Claude/OpenAI) are made within seconds, draining monthly API limits and increasing billing.
   - **Telegram Message Flood**: 20 long messages containing AI comments arrive at once in Telegram, drowning out the highest-conviction trade opportunities.

---

## 2. Objectives & Principles

1. **Hard Cost Ceiling**: Prevent mass market flushes from draining API budgets in a single candle.
2. **Prioritize Conviction**: Ensure the highest quality setups (e.g. 5★ / 6★ or core assets like BTC/ETH) get AI reviews first.
3. **No Lost Signals**: Strategies that do not receive an AI evaluation must still send standard Telegram alerts (without the AI comment block) so the user never misses an entry signal.
4. **User Granular Control**: Allow the user to decide which strategies are eligible for AI reviews, and configure limits directly from the Settings UI.

---

## 3. Architecture & Design

### Phase 1: Core Controls (High Impact & Immediate Value)

#### 3.1 Per-Strategy AI Gatekeeper Opt-In
Add an explicit toggle to each strategy definition:
```ts
// src/types/strategy.ts
export interface Strategy {
  ...
  /**
   * When true, this strategy is eligible for AI Gatekeeper evaluation on signals.
   * If false, signal alerts are sent as standard alerts without LLM evaluation.
   * Defaults to false (or opt-in).
   */
  aiGatekeeperEnabled?: boolean;
}
```
* **UI**: In the strategy editor (`StrategyForm.tsx`), under the Telegram alert settings, add a checkbox:
  `[ ] Run AI Gatekeeper Analysis (LLM review & verdict on 4+ star signals)`.
* **Benefit**: The user can reserve AI evaluations for high-conviction swing strategies or major pairs (BTC, ETH), leaving secondary or experimental altcoin strategies on standard notifications.

#### 3.2 Per-Cron Cycle Evaluation Cap & Priority Queue
In `src/app/api/cron/check-alerts/route.ts`, throttle how many AI evaluations can occur per cron cycle (default: **Max 2 per candle/minute**):
1. Evaluate strategy signal conditions for all strategies first.
2. Identify all strategies that fired and are eligible for AI review (`aiGatekeeperEnabled && rating >= minStars`).
3. **Sort/Rank by Priority**:
   - Primary: Highest signal star rating (`rating` descending: 6★ > 5★ > 4★).
   - Secondary: Score / Major asset priority (e.g. BTCUSDT first).
4. **Partition**:
   - **Top N (e.g. 2)**: Execute `evaluateOrder(...)` and attach full AI comments.
   - **Remaining**: Send standard Telegram signal message without AI evaluation, with an optional tag: `[AI Evaluation: Skipped (Cycle cap reached)]`.

#### 3.3 Configurable Settings UI
In `src/app/settings/page.tsx` & `SettingsForm.tsx`, add controls to the AI Gatekeeper section:
* **Max AI Evaluations per Cron Run**: Default `2` (Dropdown: 1, 2, 3, 5, Unlimited).
* **Minimum Star Rating for AI**: Default `4★` (Dropdown: 4★, 5★, 6★).
* Store in the existing `settings` key-value table:
  - `ai_gatekeeper_max_per_cycle`
  - `ai_gatekeeper_min_stars`

---

### Phase 2: Enhanced Circuit Breaker (Optional / Follow-up)

#### 3.4 Hourly Velocity Circuit Breaker
* Track the count of AI evaluations conducted in the rolling hour.
* If AI evaluations exceed an hourly cap (e.g. `10 evaluations / hour`), automatically pause further AI calls until the next hour, sending standard alerts in the interim.

#### 3.5 Market Flush Aggregation (Batch Digest)
* When ≥ 3 strategies fire in the same minute:
  - Send 1 consolidated Telegram digest:
    `🚨 Market Flush Alert: 5 strategies fired simultaneously (BTC, ETH, SOL, AVAX, DOGE)`
  - Run **1** Macro market evaluation instead of 5 individual ones, saving 80% of tokens while delivering better macro context.

---

## 4. Implementation Breakdown

| Component | Changes Required |
| :--- | :--- |
| `src/types/strategy.ts` | Add `aiGatekeeperEnabled?: boolean` to `Strategy` interface. |
| `src/components/strategy/StrategyForm.tsx` | Add `Run AI Gatekeeper Analysis` toggle in Strategy notify section. |
| `src/lib/strategy/rating.ts` | Update `shouldRunAiVerdict` to accept dynamic `minRating` parameter. |
| `src/lib/db/aiSettings.ts` | Add getters for `ai_gatekeeper_max_per_cycle` and `ai_gatekeeper_min_stars`. |
| `src/components/settings/SettingsForm.tsx` | Add inputs for Max AI evals per cycle and Min Star threshold. |
| `src/app/api/settings/route.ts` | Expose and persist the two new settings keys. |
| `src/app/api/cron/check-alerts/route.ts` | Reorder signal processing: evaluate conditions -> rank candidates -> execute top N AI evaluations -> dispatch Telegram messages. |

---

## 5. Acceptance Criteria

1. **Per-Strategy Control**: Strategies with `aiGatekeeperEnabled = false` NEVER invoke LLM evaluation, regardless of star rating.
2. **Cycle Cap Enforcement**: When 10 strategies with `aiGatekeeperEnabled = true` fire at once, only the top `N` (configured max, e.g. 2) trigger LLM evaluation calls.
3. **No Lost Alerts**: All 10 strategies still deliver their Telegram alerts; the lower-ranked 8 deliver standard signal messages without failing or being skipped.
4. **Dynamic Threshold**: Changing the Min Star Rating to 5★ in Settings immediately prevents 4★ signals from invoking LLM calls without requiring code changes or server restarts.
5. **Zero Breaking Changes**: Existing strategies without `aiGatekeeperEnabled` field gracefully default to existing behavior or safe default.
6. **Typecheck & Tests**: `npm run typecheck` and test suites pass cleanly.
