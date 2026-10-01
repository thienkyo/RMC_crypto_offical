# Plan: Dedicated Mobile Monitoring UI

> Status: planned — ready for implementation  
> Date: 2026-10-01  
> Scope: Lightweight, stripped-down mobile UI focused on real-time market monitoring and essential quick actions.

---

## 1. Executive Summary & Objective

The current RMC Crypto interface is a high-density, multi-panel desktop trading terminal (fixed `overflow: hidden`, 3-column side-by-side layout >1600px, complex nested indicator builders, and keyboard shortcuts).

Rather than forcing the entire desktop station onto small phone viewports, this plan defines a **dedicated, stripped-down mobile monitoring interface**. It is optimized for on-the-go market tracking, live signal alerts, quick strategy toggles, and 1-tap AI chart checks, while leaving the desktop application 100% untouched.

### Core Principles
1. **Zero Desktop Regressions**: Desktop code remains intact; mobile renders conditionally based on viewport width (`< 768px`) with an optional "Switch to Desktop" override.
2. **Reuse 100% of Existing State & APIs**: Shares the existing Zustand stores (`useChartStore`, `useWatchlistStore`, `useStrategyStore`), Binance WebSockets, and AI evaluator endpoints without duplicated backend logic.
3. **Touch-First & Thumb-Friendly**: Fast bottom navigation bar, minimum 44px tap targets, zero dependence on hover states, and smooth iOS/Android safe-area handling.
4. **Fast Performance**: Single-pane candlestick chart with no heavy multi-pane indicator stacking to preserve battery and maintain 60 FPS on mobile.

---

## 2. Scope Matrix

| Feature | Included in Mobile Monitoring UI | Kept Desktop-Only |
| :--- | :---: | :---: |
| **Watchlist & Tickers** | ✅ Live prices, 24h %, favorites, search | — |
| **Candlestick Chart** | ✅ Single-pane LWC canvas, timeframe pills | ❌ Multi-chart splits (2x2, 1x2) |
| **Indicators on Chart** | ✅ Fast overlays (EMA 20/50/200, VP POC) | ❌ 3+ stacked sub-chart panes |
| **Live Signals Feed** | ✅ Real-time cards, PnL badge, trigger reason | — |
| **Strategy Control** | ✅ Quick toggle active/inactive (`⏻`) | ❌ Multi-group visual Strategy Builder |
| **Backtesting Engine** | — | ❌ Monte Carlo & trade equity run |
| **AI Copilot** | ✅ 1-tap chart evaluate (`PASS`/`CAVEAT`/`REJECT`) | ❌ Multi-provider custom prompt builder |
| **News & Alerts** | ✅ Sentiment cards, alert mute/unmute | ❌ Custom feed scraper setup & testing |

---

## 3. Mobile UI Architecture & Tab Structure

Mobile layout operates in full dynamic viewport height (`100dvh`) with a fixed **Top Bar**, a scrollable/interactive **Content Body**, and a fixed **Bottom Navigation Bar**.

```
┌───────────────────────────────────────────────────────────┐
│ [RMC]  BTCUSDT  $64,250.00 (+2.4%)          [🔍] [⚙️]    │ ◄── Top Header (44px)
├───────────────────────────────────────────────────────────┤
│                                                           │
│                                                           │
│                 ACTIVE TAB CONTENT AREA                   │
│                                                           │
│  [1. Watch]     [2. Chart]     [3. Signals]   [4. Alerts] │
│                                                           │
│                                                           │
├───────────────────────────────────────────────────────────┤
│    [📈 Watch]     [📊 Chart]     [⚡ Signals]   [🔔 Alerts] │ ◄── Bottom Nav (56px + Safe Area)
└───────────────────────────────────────────────────────────┘
```

### Tab 1: Watch (Market Overview)
* **Header / Filter**: Segmented control: `Favorites (★)` | `Crypto` | `Equities / Mag 7`.
* **Symbol Rows (Touch targets ≥ 52px)**:
  * Left: Favorite star toggle + Symbol name + base currency subtitle.
  * Right: Live ticking price (green/red flash animation) + 24h change pill.
* **Actions**: Tapping a row sets the global active symbol in `useChartStore` and switches immediately to the Chart tab.
* **Search / Add**: Top quick search bar to filter or add custom Binance/Yahoo tickers.

### Tab 2: Chart (Single-Pane Touch Monitor)
* **Top Ribbon**: Timeframe selector pills (`15m`, `1h`, `4h`, `1d`), Volume Profile toggle chip (`VP`), and `Now` (scroll to live edge) button.
* **Canvas Area**:
  * Lightweight Charts candlestick series occupying the primary viewport.
  * Configured with `rightPriceScale.minimumWidth: 55` (reduced from desktop 80px) to maximize horizontal candle visibility.
  * Touch gesture handling: isolated canvas pinch/zoom and crosshair drag.
* **Bottom Overlay Bar**: 24h High, 24h Low, 24h Volume, and current candle countdown timer (`CandleTimerInline`).

### Tab 3: Signals & AI (Live Intelligence & Control)
* **Section A — Active Strategy Signals**:
  * Stream of recent entry/exit signals with direction pills (`LONG` 🟢 / `SHORT` 🔴), timestamp, and realized PnL.
  * Strategy status list with instant activate/deactivate toggle switch (`⏻`).
* **Section B — 1-Tap AI Copilot Check**:
  * A prominent **"Evaluate Current Chart"** button that captures the mobile canvas screenshot and queries the active AI model.
  * Quick verdict display:
    * `PASS` 🟢 / `CAVEAT` 🟡 / `REJECT` 🔴
    * 2-sentence summary rationale, confidence score, and recommended stop-loss/take-profit guidance.

### Tab 4: Alerts & News (Market Awareness)
* **Alerts Manager**:
  * Active price alerts list with toggle on/off switch and swipe-to-delete.
  * Compact "Add Alert" button (target price, above/below condition).
* **News & Telegram Sentiment Stream**:
  * Mobile news card feed with author/source, publication time, and sentiment pill (Bullish / Neutral / Bearish).
  * External link tap to open full article in browser.

---

## 4. Technical Implementation Plan

### 4.1. File Additions & Modifications

```
src/
├── hooks/
│   └── useIsMobile.ts                     [NEW]  Viewport detection (<768px) + storage override
├── components/
│   └── mobile/
│       ├── MobileShell.tsx                [NEW]  Master mobile container (100dvh + tab router)
│       ├── MobileHeader.tsx               [NEW]  Compact top header with active ticker & tools
│       ├── MobileBottomNav.tsx            [NEW]  Fixed bottom navigation bar with safe-area
│       └── tabs/
│           ├── MobileWatchlistTab.tsx     [NEW]  Live ticker list & favorites
│           ├── MobileChartTab.tsx         [NEW]  Clean single-pane TradingView canvas
│           ├── MobileSignalsTab.tsx       [NEW]  Signal cards, strategy ⏻, and 1-tap AI check
│           └── MobileAlertsNewsTab.tsx    [NEW]  Active alerts & sentiment stream
└── app/
    ├── page.tsx                           [EDIT] Mount <MobileShell /> if isMobile && !forceDesktop
    └── globals.css                        [EDIT] Add safe-area utilities & 100dvh support
```

### 4.2. Viewport Detection Hook (`src/hooks/useIsMobile.ts`)

```typescript
'use client';
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [forceDesktop, setForceDesktop] = useState<boolean>(false);

  useEffect(() => {
    // Check localStorage preference
    const saved = localStorage.getItem('rmc_force_desktop') === 'true';
    setForceDesktop(saved);

    const check = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    check();
    window.addEventListener('resize', check, { passive: true });
    return () => window.removeEventListener('resize', check);
  }, []);

  const toggleForceDesktop = () => {
    const next = !forceDesktop;
    setForceDesktop(next);
    localStorage.setItem('rmc_force_desktop', String(next));
  };

  return { isMobile: isMobile && !forceDesktop, isMobileDevice: isMobile, forceDesktop, toggleForceDesktop };
}
```

### 4.3. Root Page Integration (`src/app/page.tsx`)

```tsx
export default function Page() {
  const { isMobile } = useIsMobile();

  if (isMobile) {
    return <MobileShell />;
  }

  // Existing full desktop 3-column layout remains untouched
  return (
    <main className="flex h-full w-full overflow-hidden bg-surface">
      {/* ... Desktop Left rail, Chart, Right rail ... */}
    </main>
  );
}
```

---

## 5. Workload & Effort Estimation

| Phase | Milestone / Tasks | Complexity | Est. Dev Time |
| :--- | :--- | :---: | :---: |
| **Phase 1** | **Foundation & Navigation Shell**<br>• Create `useIsMobile.ts` with manual desktop toggle<br>• Configure safe area CSS utilities in `globals.css`<br>• Implement `MobileShell.tsx`, `MobileHeader.tsx`, `MobileBottomNav.tsx` | Low | **0.5 – 1 Day** |
| **Phase 2** | **Mobile Watchlist & Market Tickers**<br>• Create `MobileWatchlistTab.tsx` with live ticker subscription<br>• Add favorite toggle, section tabs, and symbol search modal<br>• Connect 1-tap symbol switch to `useChartStore` | Low–Medium | **0.5 – 1 Day** |
| **Phase 3** | **Single-Pane Mobile Chart**<br>• Create `MobileChartTab.tsx` wrapping lightweight-charts<br>• Timeframe ribbon pills, live ticker header, and High/Low badges<br>• Touch gesture isolation and right-scale 55px width optimization | Medium | **1 – 1.5 Days** |
| **Phase 4** | **Live Signals & 1-Tap AI Copilot**<br>• Create `MobileSignalsTab.tsx` with live signal cards<br>• Strategy activate/deactivate toggle switch (`⏻`) with DB sync<br>• 1-tap AI Evaluate button with canvas snapshot and compact verdict card | Medium | **1 – 1.5 Days** |
| **Phase 5** | **Alerts, News & Mobile Polish**<br>• Create `MobileAlertsNewsTab.tsx` for alert management & sentiment feed<br>• Add iOS Safari bottom home indicator padding (`env(safe-area-inset-bottom)`)<br>• Test on mobile viewports (iPhone SE 375px, iPhone 15 393px, Android 412px) | Low–Medium | **0.5 – 1 Day** |
| **Total** | **Complete Mobile Monitoring Experience** | | **3.5 – 5.5 Days** |

---

## 6. Risks, Concerns & Mitigations

1. **Canvas Touch Interactions vs Page Scrolling**:
   * *Risk*: In the Chart tab, dragging across the chart canvas can accidentally trigger vertical page scrolling or lock up gestures.
   * *Mitigation*: The `MobileChartTab` fixes the canvas container to a dedicated flex height without outer page scrollbars; chart panning/zooming operates within its native touch listeners, while tabs switch via the bottom navigation bar.
2. **iOS Safari Viewport Height & Home Bar**:
   * *Risk*: Classic `100vh` causes bottom bars to be hidden underneath Safari's URL toolbar or the iPhone home bar.
   * *Mitigation*: Strictly use `100dvh` container sizing with `pb-[max(0.75rem,env(safe-area-inset-bottom))]` on `MobileBottomNav`.
3. **Background WebSocket Pauses**:
   * *Risk*: When mobile screens lock or switch apps, browser WebSockets pause, leading to stale prices upon returning.
   * *Mitigation*: Listen to `visibilitychange` events; automatically trigger a lightweight candle refresh when `document.visibilityState === 'visible'`.
4. **Desktop User Preference**:
   * *Risk*: Some users accessing on tablets or large mobile screens may still want the full desktop terminal.
   * *Mitigation*: Provide a prominent "🖥️ Desktop View" toggle in the mobile header/settings that sets a persistent localStorage flag.

---

## 7. Verification & Success Criteria

1. **Responsive Switch**: Opening the app on a screen `< 768px` automatically presents the Mobile Shell; resizing above 768px or toggling "Desktop View" restores the full 3-column terminal.
2. **Live Data & Performance**:
   * Live prices in Watchlist flash green/red upon WebSocket ticks without UI stutter.
   * Candlestick chart renders smoothly at 60 FPS on touch drag/pinch.
3. **Action Execution**:
   * Tapping a symbol switches the active chart immediately.
   * Toggling a strategy's active state (`⏻`) updates the database and reflects across both mobile and desktop views.
   * 1-tap AI check captures the current chart and delivers a formatted evaluation card within <5 seconds.
4. **Ergonomics**: All buttons and list items satisfy the minimum 44x44px touch target guideline.
