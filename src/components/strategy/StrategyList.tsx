'use client';

/**
 * StrategyList — left rail showing saved strategies.
 * Clicking a strategy selects it; trash icon deletes it.
 */

import {
  useStrategyStore,
  createDefaultStrategy,
} from '@/store/strategy';

export function StrategyList() {
  const strategies          = useStrategyStore((s) => s.strategies);
  const activeId            = useStrategyStore((s) => s.activeStrategyId);
  const setActiveStrategy   = useStrategyStore((s) => s.setActiveStrategy);
  const deleteStrategy      = useStrategyStore((s) => s.deleteStrategy);
  const upsertStrategy      = useStrategyStore((s) => s.upsertStrategy);
  const toggleStrategyActive = useStrategyStore((s) => s.toggleStrategyActive);
  const duplicateStrategy    = useStrategyStore((s) => s.duplicateStrategy);

  function handleNew() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
  }

  return (
    <aside className="w-52 flex-shrink-0 border-r border-surface-border flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-surface-border">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Strategies
        </span>
        <button
          type="button"
          onClick={handleNew}
          className="btn-icon-xs text-text-muted hover:text-text-primary"
          title="New strategy"
        >
          +
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {strategies.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted italic">
            No strategies yet.
          </p>
        )}
        {strategies.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-2 transition-colors ${
              activeId === s.id ? 'bg-surface-2 border-l-2 border-blue-500' : ''
            }`}
            onClick={() => setActiveStrategy(s.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-text-primary truncate">{s.name}</span>
                {(s.isActive ?? false) && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                )}
              </div>
              <div className="text-xs text-text-muted font-mono">
                {s.symbol} · {s.timeframe}
              </div>
            </div>

            <div className="flex items-center gap-0.5 ml-1">
              {/* Live monitor ON/OFF toggle */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStrategyActive(s.id);
                }}
                className={`btn-icon-xs transition-colors ${
                  (s.isActive ?? false)
                    ? 'text-emerald-400 hover:text-emerald-300'
                    : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary'
                }`}
                title={(s.isActive ?? false) ? 'Turn off live monitor' : 'Turn on live monitor'}
              >
                ⏻
              </button>

              {/* Duplicate */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateStrategy(s.id);
                }}
                className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary transition-opacity"
                title="Duplicate strategy"
              >
                ⧉
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${s.name}"?`)) deleteStrategy(s.id);
                }}
                className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                title="Delete"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
