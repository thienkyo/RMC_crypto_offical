'use client';

import { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Watchlist } from '@/components/watchlist/Watchlist';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { NewsFeed } from '@/components/news/NewsFeed';
import { AlertManager } from '@/components/alerts/AlertManager';
import { useAlertPoller } from '@/hooks/useAlertPoller';
import { useLayoutStore } from '@/store/layout';

/**
 * ChartLayout is dynamically imported with ssr: false.
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
 * Main page — full-viewport layout.
 * Rail visibility is controlled via useLayoutStore so ChartLayout can also
 * read / toggle them from its own top bar buttons.
 *
 * Keyboard shortcuts: [ = toggle left rail, ] = toggle right rail.
 */
export default function Page() {
  const captureRef = useRef<(() => string | null) | null>(null);
  const [railTab, setRailTab] = useState<RailTab>('analysis');

  const { leftRailVisible, rightRailVisible, toggleLeft, toggleRight } = useLayoutStore();

  useAlertPoller();

  // Keyboard shortcuts: [ / ] — ignored while typing in inputs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '[') toggleLeft();
      if (e.key === ']') toggleRight();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeft, toggleRight]);

  return (
    <main className="flex h-full w-full overflow-hidden bg-surface">

      {/* ── Left rail (Watchlist) ─────────────────────────────────────────
          max-width collapses reliably on flex items; overflow-hidden clips
          the Watchlist's internal w-[220px] when collapsed.              */}
      <div
        className={`flex-shrink-0 overflow-hidden
                    transition-[max-width] duration-200 ease-in-out
                    ${leftRailVisible ? 'max-w-[220px]' : 'max-w-0'}`}
      >
        <Watchlist />
      </div>

      {/* ── Chart (flex-1) ────────────────────────────────────────────────
          ChartLayout renders the left/right toggle buttons in its top bar. */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <ChartLayout
          onCaptureMounted={(fn) => { captureRef.current = fn; }}
        />
      </div>

      {/* ── Right rail ───────────────────────────────────────────────────── */}
      <div
        className={`flex-shrink-0 overflow-hidden flex flex-col
                    w-[420px] border-l border-surface-border
                    transition-[max-width] duration-200 ease-in-out
                    ${rightRailVisible ? 'max-w-[420px]' : 'max-w-0'}`}
      >
        {/* Tab bar */}
        <div className="flex border-b border-surface-border flex-shrink-0">
          {(['analysis', 'news', 'alerts'] as RailTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
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
