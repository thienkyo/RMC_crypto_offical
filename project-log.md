# Project Log

All notable changes, features, improvements, and bug fixes to the RMC Crypto platform will be documented in this file.

---

## [2026-11-12]

### 🚀 New Features
- **Technical Invalidation Engine & Early Exit Alerts (`src/lib/alerts/signalMonitor.ts`)**:
  - Added automated post-signal monitoring on closed candles (`evaluateTechnicalInvalidation`).
  - Detects when price action moves opposite to an active signal in drawdown (`pnlPct <= -0.3%`) by checking if price breaks the prior bar extreme against the trade and closes beyond the 20 EMA.
  - Automatically closes the monitor (`exit_reason = 'invalidated'`) and sends a threaded Telegram warning alert (`⚠️ Signal Invalidated (Early Exit Warning)`) to preserve capital before reaching full stop loss.
  - Full test coverage with 12 unit tests in `src/lib/alerts/signalMonitor.test.ts`.

### 🔄 Improvements
- **Strategy Momentum Alignment Filter (PAXG 4h & Core Strategies)**:
  - **Context:** Investigated false counter-trend signals on PAXGUSDT 4h (Signals #920 & #910) where high ADX triggered SHORT entries during an ongoing bullish rally.
  - **Change:** Added `MACD(12,26,9,200)[2] < 0` for SHORT and `> 0` for LONG to the `[ADX Trend-Following]` condition group across all 12 active strategies (`UTILMATE_S`, `UTILMATE_L` on BTC, ETH, PAXG, BNB, NEAR).
  - Synchronized across PostgreSQL live strategies, `strategy_versions` history, and `src/lib/strategy/starterTemplates.ts`.

### 🐛 Bug Fixes & Issues Resolved
- **Telegram Topic Bigint Parsing Error (`src/lib/alerts/signalMonitor.ts`)**:
  - Resolved `invalid input syntax for type bigint: "PAXGUSDT"` error when sending signal alerts to symbol topics.
  - Fixed by resolving numeric `message_thread_id` from `telegram_topics` table instead of passing raw string topic names.
- **Chart Viewport Historical Jump (`src/components/chart/ChartLayout.tsx`, `PriceChart.tsx`)**:
  - Fixed a viewport bug where loading or switching views caused the chart to snap backwards to historical 2025 candles during hydration.
  - Ensured visible range anchoring stays locked to current live candles.
