'use client';

/**
 * StrategyList — left rail showing saved strategies grouped by symbol.
 * Each symbol group is collapsible. Clicking a strategy selects it.
 */

import { useState, useMemo } from 'react';
import {
  useStrategyStore,
  createDefaultStrategy,
} from '@/store/strategy';
import type { Strategy } from '@/types/strategy';

// ── Strategy row ──────────────────────────────────────────────────────────────

interface RowProps {
  s:      Strategy;
  active: boolean;
  onSelect:   () => void;
  onToggle:   () => void;
  onDuplicate: () => void;
  onDelete:   () => void;
}

function StrategyRow({ s, active, onSelect, onToggle, onDuplicate, onDelete }: RowProps) {
  return (
    <div
      className={`group flex items-center justify-between px-3 py-2 cursor-pointer
                  hover:bg-surface-2 transition-colors
                  ${active ? 'bg-surface-2 border-l-2 border-blue-500' : 'border-l-2 border-transparent'}`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-text-primary truncate">{s.name}</span>
          {(s.isActive ?? false) && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
          )}
        </div>
        <div className="text-xs text-text-muted font-mono">{s.timeframe}</div>
      </div>

      <div className="flex items-center gap-0.5 ml-1">
        {/* Live monitor toggle */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
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
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
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
            if (confirm(`Delete "${s.name}"?`)) onDelete();
          }}
          className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StrategyList() {
  const strategies           = useStrategyStore((s) => s.strategies);
  const activeId             = useStrategyStore((s) => s.activeStrategyId);
  const setActiveStrategy    = useStrategyStore((s) => s.setActiveStrategy);
  const deleteStrategy       = useStrategyStore((s) => s.deleteStrategy);
  const upsertStrategy       = useStrategyStore((s) => s.upsertStrategy);
  const toggleStrategyActive = useStrategyStore((s) => s.toggleStrategyActive);
  const duplicateStrategy    = useStrategyStore((s) => s.duplicateStrategy);

  // Which symbol groups are collapsed. Default: all expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(symbol: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  // Group strategies by symbol, preserving insertion order of first appearance.
  const groups = useMemo(() => {
    const map = new Map<string, Strategy[]>();
    for (const s of strategies) {
      if (!map.has(s.symbol)) map.set(s.symbol, []);
      map.get(s.symbol)!.push(s);
    }
    return map;
  }, [strategies]);

  function handleNew() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
  }

  function handleToggle(s: Strategy) {
    toggleStrategyActive(s.id);
    const updated = { ...s, isActive: !(s.isActive ?? false) };
    fetch('/api/strategies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updated),
    }).catch((err) => console.warn('[strategy-list:toggle] DB sync failed:', err));
  }

  function handleDelete(s: Strategy) {
    deleteStrategy(s.id);
    fetch(`/api/strategies?id=${s.id}`, { method: 'DELETE' })
      .catch((err) => console.warn('[strategy-list:delete] DB sync failed:', err));
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

        {Array.from(groups.entries()).map(([symbol, list]) => {
          const isCollapsed = collapsed.has(symbol);
          const activeCount = list.filter((s) => s.isActive ?? false).length;

          return (
            <div key={symbol}>
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(symbol)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5
                           text-text-muted hover:text-text-primary hover:bg-surface-2
                           transition-colors select-none"
              >
                {/* Chevron */}
                <span className={`text-[10px] transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}>
                  ▾
                </span>

                {/* Symbol */}
                <span className="text-[11px] font-mono font-semibold text-text-secondary flex-1 text-left truncate">
                  {symbol}
                </span>

                {/* Active pulse dot */}
                {activeCount > 0 && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                )}

                {/* Count badge */}
                <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                  {list.length}
                </span>
              </button>

              {/* Strategies in group */}
              {!isCollapsed && list.map((s) => (
                <StrategyRow
                  key={s.id}
                  s={s}
                  active={activeId === s.id}
                  onSelect={() => setActiveStrategy(s.id)}
                  onToggle={() => handleToggle(s)}
                  onDuplicate={() => duplicateStrategy(s.id)}
                  onDelete={() => handleDelete(s)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
