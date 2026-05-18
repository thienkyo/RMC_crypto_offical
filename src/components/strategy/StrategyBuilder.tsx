'use client';

/**
 * StrategyBuilder — top-level layout for the strategy page.
 *
 * Layout:
 *  ┌─────────────┬──────────────────────────┬────────────────────────┐
 *  │ StrategyList│   StrategyForm            │ Right panel            │
 *  │ (left rail) │   (editor, scrollable)    │ [Signals | Backtest]   │
 *  └─────────────┴──────────────────────────┴────────────────────────┘
 *
 * Right panel is always visible when a strategy is selected.
 * Signals tab: cron-fired signal log for the active strategy.
 * Backtest tab: equity curve + trade list (shown when a run exists).
 */

import { useState, useEffect } from 'react';
import { useStrategyStore, selectActiveStrategy, createDefaultStrategy } from '@/store/strategy';
import { StrategyList }   from './StrategyList';
import { StrategyForm }   from './StrategyForm';
import { BacktestPanel }  from './BacktestPanel';
import { SignalHistory }  from './SignalHistory';

type RightTab = 'signals' | 'backtest';

export function StrategyBuilder() {
  const activeStrategy       = useStrategyStore(selectActiveStrategy);
  const isBacktesting        = useStrategyStore((s) => s.isBacktesting);
  const backtestHistory      = useStrategyStore((s) => s.backtestHistory);
  const clearBacktestHistory = useStrategyStore((s) => s.clearBacktestHistory);
  const upsertStrategy       = useStrategyStore((s) => s.upsertStrategy);
  const setActiveStrategy    = useStrategyStore((s) => s.setActiveStrategy);

  const [activeTab,     setActiveTab]     = useState<RightTab>('signals');
  const [rightVisible,  setRightVisible]  = useState(true);

  // ']' toggles the right rail
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ']' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Don't fire when the user is typing in an input / textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        setRightVisible((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const history = activeStrategy
    ? (backtestHistory[activeStrategy.id] ?? [])
    : [];

  function handleNew() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left rail: strategy list ────────────────────────────────── */}
      <StrategyList />

      {/* ── Centre: form editor ─────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-hidden border-r border-surface-border flex flex-col">
        {activeStrategy ? (
          <StrategyForm key={activeStrategy.id} strategy={activeStrategy} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
            <span className="text-4xl">📐</span>
            <p className="text-sm">No strategy selected.</p>
            <button
              type="button"
              onClick={handleNew}
              className="btn-sm btn-primary"
            >
              + New Strategy
            </button>
          </div>
        )}
      </main>

      {/* ── Right panel: toggle with ] key ─────────────────────────── */}
      {activeStrategy && rightVisible && (
        <aside className="w-[40rem] flex-shrink-0 flex flex-col bg-surface border-l border-surface-border">

          {/* Tab bar */}
          <div className="flex-shrink-0 flex border-b border-surface-border">
            <TabButton
              label="Signals"
              active={activeTab === 'signals'}
              onClick={() => setActiveTab('signals')}
            />
            <TabButton
              label={`Backtest${history.length > 0 ? ` (${history.length})` : ''}`}
              active={activeTab === 'backtest'}
              onClick={() => setActiveTab('backtest')}
              highlight={history.length > 0 || isBacktesting}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'signals' && (
              <SignalHistory strategyId={activeStrategy.id} />
            )}

            {activeTab === 'backtest' && (
              <>
                {isBacktesting && (
                  <div className="flex items-center justify-center gap-2 text-text-muted text-sm
                                  animate-pulse px-4 py-3 border-b border-surface-border">
                    Running backtest…
                  </div>
                )}
                {history.length > 0 ? (
                  <BacktestPanel
                    history={history}
                    onClearHistory={() => clearBacktestHistory(activeStrategy.id)}
                  />
                ) : (
                  !isBacktesting && (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted">
                      <span className="text-2xl">📊</span>
                      <p className="text-xs">No backtest run yet.</p>
                      <p className="text-xs text-text-muted/60">
                        Run one from the strategy editor.
                      </p>
                    </div>
                  )
                )}
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

interface TabButtonProps {
  label:      string;
  active:     boolean;
  onClick:    () => void;
  highlight?: boolean;
}

function TabButton({ label, active, onClick, highlight }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors
                  border-b-2 select-none
                  ${active
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                  }
                  ${highlight && !active ? 'text-text-secondary' : ''}`}
    >
      {label}
    </button>
  );
}
