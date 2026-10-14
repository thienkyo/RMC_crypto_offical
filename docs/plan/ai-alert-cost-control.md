# Plan: AI Signal Alert Cost & Flood Control (Options E + A + C)

> Status: APPROVED ARCHITECTURE — Ready for Implementation  
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

1. **Market Flush Protection (Option E)**: When ≥ 3 strategies fire in the same cycle, collapse the flood into **1 Consolidated Market Digest** with **1 Macro AI Evaluation**, saving 80–95% of API tokens and stopping Telegram spam.
2. **Per-Cycle Rate Limit (Option A)**: For normal isolated cycles (< 3 signals), cap individual AI reviews to **Max N (default 2)** per cycle, ranked by conviction (stars/score).
3. **Per-Strategy Precision (Option C)**: Allow the user to toggle which strategies are allowed to invoke AI Gatekeeper via an explicit checkbox.
4. **No Lost Signals**: All triggered strategies are either listed in the consolidated digest or sent as standard signals.

---

## 3. Architecture & Unified Pipeline

### 3.1 Option C: Per-Strategy AI Gatekeeper Opt-In
Add an explicit toggle to each strategy definition:
```ts
// src/types/strategy.ts
export interface Strategy {
  ...
  /**
   * When true, this strategy is eligible for AI Gatekeeper evaluation on signals.
   * If false, signal alerts are sent as standard alerts without LLM evaluation.
   * Defaults to false (opt-in).
   */
  aiGatekeeperEnabled?: boolean;
}
```
* **UI**: In the strategy editor (`StrategyForm.tsx`) under Telegram topic & notification settings, add a checkbox:  
  `[ ] Enable AI Gatekeeper Review (LLM evaluation & verdict on signal trigger)`.
* **Benefit**: Experimental, scalping, or minor altcoin strategies won't trigger expensive AI calls unless explicitly enabled.

### 3.2 The Unified Cron Decision Engine (`check-alerts`)

In `src/app/api/cron/check-alerts/route.ts`, signal processing runs through a two-branch router:

```
cron checks all strategies -> M signals fired:

IF M >= 3 (Market Flush):
  -> BRANCH 1: Option E (Consolidated Market Digest)
  -> Make 1 Macro AI Evaluation call (evaluating the broader market move)
  -> Dispatch 1 single formatted Telegram message containing:
       - Header: 🚨 MARKET FLUSH: M Strategies Triggered Simultaneously
       - Breakdown table: [BTC | Long | 5★], [ETH | Long | 4★], [PAXG | Short | 4★]
       - Unified AI Market Analysis & Risk Verdict

IF M < 3 (Isolated Signals):
  -> BRANCH 2: Option A + C (Individual Signal Handling)
  -> Filter strategies having (aiGatekeeperEnabled === true && rating >= 4)
  -> If candidates > MaxCycleCap (default 2):
       - Top candidates get full individual AI evaluation
       - Remaining candidates get standard Telegram alert without AI comment
  -> Dispatch individual Telegram messages as today
```

### 3.3 Option E: Market Flush Digest Message Format

```text
🚨 MARKET FLUSH DETECTED (5 Signals Fired)
Time: 2026-10-03 04:00 UTC | Timeframe: 4h

📋 Triggered Strategies:
• BTCUSDT: RSI Oversold (🟢 LONG | Limit $62,100 | 5★)
• ETHUSDT: EMA Cross (🟢 LONG | Market $2,420 | 4★)
• SOLUSDT: Support Bounce (🟢 LONG | Market $135 | 4★)
• PAXGUSDT: Safe Haven (🔴 SHORT | Market $2,650 | 4★)
• AVAXUSDT: Oversold (🟢 LONG | Market $24.50 | 4★)

🧠 AI Macro Market Assessment:
Verdict: 🟡 CAVEAT — Correlation Flush
Summary: Bitcoin breakdown triggered cascaded liquidations across altcoins.
High volatility spike (ATR +40%). Long setups carry knife-catch risk.
Wait for 4h candle close confirmation before entering altcoin longs.
```

---

## 4. Implementation Steps

1. **Data Model (`src/types/strategy.ts`)**:
   - Add `aiGatekeeperEnabled?: boolean` to `Strategy`.
2. **Strategy Form UI (`src/components/strategy/StrategyForm.tsx`)**:
   - Add toggle for `aiGatekeeperEnabled` next to Telegram notification settings.
3. **Macro Evaluator Service (`src/lib/ai/evaluator/macro.ts`)**:
   - Lightweight gateway function `evaluateMarketFlush(signals, btcCandles)` that prompts LLM for a high-level correlation analysis.
4. **Telegram Formatter (`src/lib/alerts/telegram.ts`)**:
   - Add `formatMarketFlushMessage(...)` for Option E digest layout.
5. **Cron Orchestrator (`src/app/api/cron/check-alerts/route.ts`)**:
   - Implement the threshold router (M ≥ 3 -> Digest vs M < 3 -> Individual with Cap).
6. **Verification & Tests**:
   - Test single signal execution (Option C + A).
   - Test simulated 5-signal market flush (Option E).

---

## 5. Acceptance Criteria

1. **Option C**: A strategy with `aiGatekeeperEnabled = false` never triggers an individual LLM call.
2. **Option E**: When 5 strategies fire at the same candle, only **1 Telegram message** is sent and only **1 Macro AI call** is made.
3. **Option A**: When 2 strategies fire in an isolated move, individual AI evaluations run up to the cycle cap without creating a digest.
4. **Zero Lost Signals**: Every fired strategy is recorded in the DB and communicated to Telegram (either in the Digest or as individual alert).
