'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Watchlist } from '@/components/watchlist/Watchlist';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { NewsFeed } from '@/components/news/NewsFeed';
import { AlertManager } from '@/components/alerts/AlertManager';
import { useAlertPoller } from '@/hooks/useAlertPoller';

/**
 * ChartLayout is dynamically imported with ssr: false.
 * `next/dynamic` with ssr:false must live inside a 'use client' file in Next.js 15.
 * TradingView Lightweight Charts uses canvas/WebSocket — browser-only APIs.
 */
const ChartLayout = dynamic(
  () => import('@/components/chart/ChartLayout').then((m) => m.ChartLayout),
  {
    ssr:     false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm animate-pulse">
        Loading chart…
      </div>
    ),
  },
);

type RailTab = 'analysis' | 'news' | 'alerts';

/**
 * Main page — full-viewport layout:
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  Watchlist (220px) │ ChartLayout (flex) │ Right rail     │
 *  │                    │                    │  [AI] [News]   │
 *  │                    │                    │  <active panel>│
 *  └──────────────────────────────────────────────────────────┘
 *
 * The right rail has three tabs: AI Analysis (Phase 3), News (Phase 4), Alerts (Phase 5).
 */
export default function Page() {
  // Holds the screenshot function registered by ChartLayout once it mounts.
  // Using a ref (not state) so registering it doesn't trigger a re-render.
  const captureRef = useRef<(() => string | null) | null>(null);
  const [railTab, setRailTab] = useState<RailTab>('analysis');

  // Automatically poll the alert evaluation loop every 60 s.
  // This replaces the Vercel cron in local dev — no manual button needed.
  useAlertPoller();

  return (
    <main className="flex h-full w-full overflow-hidden bg-surface">
      <Watchlist />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <ChartLayout
          onCaptureMounted={(fn) => { captureRef.current = fn; }}
        />
      </div>

      {/* Right rail — 420px fixed, tabbed: AI Analysis | News | Alerts */}
      <div className="w-[420px] flex-shrink-0 flex flex-col overflow-hidden border-l border-surface-border">

        {/* Tab bar */}
        <div className="flex border-b border-surface-border flex-shrink-0">
          {(['analysis', 'news', 'alerts'] as RailTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setRailTab(tab)}
              className={`flex-1 h-10 text-[11px] font-mono uppercase tracking-widest transition-colors
                ${railTab === tab
                  ? 'text-accent border-b-2 border-accent bg-accent/5'
                  : 'text-text-muted hover:text-text-primary'
                }`}
            >
              {tab === 'analysis' ? 'AI' : tab === 'news' ? 'News' : '🔔'}
            </button>
          ))}
        </div>

        {/* Panel content — all stay mounted to avoid re-fetch on tab switch */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${railTab === 'analysis' ? 'block' : 'hidden'}`}>
          <AnalysisPanel getScreenshot={() => captureRef.current?.() ?? null} />
        </div>
        <div className={`flex-1 overflow-hidden ${railTab === 'news' ? 'block' : 'hidden'}`}>
          <NewsFeed />
        </div>
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${railTab === 'alerts' ? 'block' : 'hidden'}`}>
          <AlertManager />
        </div>
      </div>
    </main>
  );
}
