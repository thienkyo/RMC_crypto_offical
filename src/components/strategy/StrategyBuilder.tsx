'use client';

/**
 * StrategyBuilder — top-level layout for the strategy page.
 *
 * Layout:
 *  ┌─────────────┬──────────────────────────┬────────────────────────┐
 *  │ StrategyList│   StrategyForm            │ BacktestPanel          │
 *  │ (left rail) │   (editor, scrollable)    │ (results, shown when   │
 *  │             │                           │  a backtest has run)   │
 *  └─────────────┴──────────────────────────┴────────────────────────┘
 *
 * When no strategy is selected, a centered prompt is shown.
 * When a backtest result is available it appears in the right panel.
 */

import { useStrategyStore, selectActiveStrategy, createDefaultStrategy } from '@/store/strategy';
import { StrategyList }  from './StrategyList';
import { StrategyForm }  from './StrategyForm';
import { BacktestPanel } from './BacktestPanel';

export function StrategyBuilder() {
  const activeStrategy      = useStrategyStore(selectActiveStrategy);
  const isBacktesting       = useStrategyStore((s) => s.isBacktesting);
  const backtestHistory     = useStrategyStore((s) => s.backtestHistory);
  const clearBacktestHistory = useStrategyStore((s) => s.clearBacktestHistory);
  const upsertStrategy      = useStrategyStore((s) => s.upsertStrategy);
  const setActiveStrategy   = useStrategyStore((s) => s.setActiveStrategy);

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
          // key forces a re-mount when the active strategy changes,
          // so useState inside StrategyForm resets to the new strategy
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

      {/* ── Right panel: backtest results ───────────────────────────── */}
      {(history.length > 0 || isBacktesting) && (
        <aside className="w-[768px] flex-shrink-0 flex flex-col bg-surface">
          {isBacktesting && (
            <div className="flex items-center justify-center gap-2 text-text-muted text-sm animate-pulse px-4 py-3 border-b border-surface-border">
              Running backtest…
            </div>
          )}
          {history.length > 0 && (
            <BacktestPanel
              history={history}
              onClearHistory={
                activeStrategy
                  ? () => clearBacktestHistory(activeStrategy.id)
                  : undefined
              }
            />
          )}
        </aside>
      )}
    </div>
  );
}
