'use client';

/**
 * StrategyList — left rail with two sections:
 *  1. Templates (collapsible) — pre-defined blueprints, clone to use
 *  2. Strategies (collapsible per symbol) — working strategies grouped by symbol
 */

import { useState, useMemo } from 'react';
import {
  useStrategyStore,
  createDefaultStrategy,
  createDefaultTemplate,
} from '@/store/strategy';
import type { Strategy } from '@/types/strategy';

// ── Template row ──────────────────────────────────────────────────────────────

interface TemplateRowProps {
  s:          Strategy;
  active:     boolean;
  onSelect:    () => void;
  onClone:     () => void;
  onDuplicate: () => void;
  onDelete:    () => void;
}

function TemplateRow({ s, active, onSelect, onClone, onDuplicate, onDelete }: TemplateRowProps) {
  return (
    <div
      className={`group flex items-center justify-between px-3 py-2 cursor-pointer
                  hover:bg-surface-2 transition-colors
                  ${active ? 'bg-surface-2 border-l-2 border-violet-500' : 'border-l-2 border-transparent'}`}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-violet-400 flex-shrink-0">✦</span>
          <span className="text-sm text-text-primary truncate">{s.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-text-muted font-mono">{s.symbol} · {s.timeframe}</span>
          <span className={`text-[9px] font-mono font-semibold px-1 py-px rounded flex-shrink-0 ${
            s.action.type === 'enter_long'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {s.action.type === 'enter_long' ? '▲ Bull' : '▼ Bear'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 ml-1">
        {/* Duplicate → another template */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary transition-opacity"
          title="Duplicate template"
        >
          ⧉
        </button>

        {/* Clone → working strategy */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClone(); }}
          className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-violet-400 transition-opacity"
          title="Clone as working strategy"
        >
          ⎘
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete template "${s.name}"?`)) onDelete();
          }}
          className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
          title="Delete template"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Strategy row ──────────────────────────────────────────────────────────────

interface RowProps {
  s:       Strategy;
  active:  boolean;
  onSelect:    () => void;
  onToggle:    () => void;
  onDuplicate: () => void;
  onDelete:    () => void;
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

// ── Section header ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  label:       string;
  isCollapsed: boolean;
  onToggle:    () => void;
  onAdd:       () => void;
  addTitle:    string;
  count:       number;
  accent?:     'blue' | 'violet';
}

function SectionHeader({ label, isCollapsed, onToggle, onAdd, addTitle, count, accent = 'blue' }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors select-none"
      >
        <span className={`text-[10px] transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}>
          ▾
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${
          accent === 'violet' ? 'text-violet-400' : 'text-text-muted'
        }`}>
          {label}
        </span>
        <span className="text-[10px] font-mono text-text-muted">{count}</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="btn-icon-xs text-text-muted hover:text-text-primary"
        title={addTitle}
      >
        +
      </button>
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
  const cloneFromTemplate    = useStrategyStore((s) => s.cloneFromTemplate);
  const loadStarterTemplates = useStrategyStore((s) => s.loadStarterTemplates);

  // Section collapse state (templates section starts collapsed by default)
  const [templatesCollapsed,  setTemplatesCollapsed]  = useState(false);
  const [strategiesCollapsed, setStrategiesCollapsed] = useState(false);
  // Which symbol groups are collapsed within the Strategies section
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(symbol: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  // Split into templates vs regular strategies
  const templates         = useMemo(() => strategies.filter((s) => s.isTemplate),  [strategies]);
  const regularStrategies = useMemo(() => strategies.filter((s) => !s.isTemplate), [strategies]);

  // Group regular strategies by symbol
  const groups = useMemo(() => {
    const map = new Map<string, Strategy[]>();
    for (const s of regularStrategies) {
      if (!map.has(s.symbol)) map.set(s.symbol, []);
      map.get(s.symbol)!.push(s);
    }
    return map;
  }, [regularStrategies]);

  function handleNewStrategy() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
  }

  function handleNewTemplate() {
    const t = createDefaultTemplate();
    upsertStrategy(t);
    setActiveStrategy(t.id);
    setTemplatesCollapsed(false);
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

  function handleClone(templateId: string) {
    cloneFromTemplate(templateId);
    setStrategiesCollapsed(false);
  }

  return (
    <aside className="w-52 flex-shrink-0 border-r border-surface-border flex flex-col bg-surface">
      {/* ── Templates section ───────────────────────────────────────────────── */}
      {/* Custom header — two action buttons (Load starters + New) */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-border">
        <button
          type="button"
          onClick={() => setTemplatesCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors select-none"
        >
          <span className={`text-[10px] transition-transform duration-150 ${templatesCollapsed ? '-rotate-90' : ''}`}>
            ▾
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
            Templates
          </span>
          <span className="text-[10px] font-mono text-text-muted">{templates.length}</span>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => { loadStarterTemplates(); setTemplatesCollapsed(false); }}
            className="btn-icon-xs text-text-muted hover:text-violet-400 transition-colors"
            title="Load starter templates (Trend-Reversal, Golden Trio, ADX)"
          >
            ⬇
          </button>
          <button
            type="button"
            onClick={handleNewTemplate}
            className="btn-icon-xs text-text-muted hover:text-text-primary"
            title="New blank template"
          >
            +
          </button>
        </div>
      </div>

      {!templatesCollapsed && (
        <div className="border-b border-surface-border">
          {templates.length === 0 && (
            <p className="px-3 py-3 text-xs text-text-muted italic">
              No templates yet. Click + to create one.
            </p>
          )}
          {templates.map((t) => (
            <TemplateRow
              key={t.id}
              s={t}
              active={activeId === t.id}
              onSelect={() => setActiveStrategy(t.id)}
              onDuplicate={() => duplicateStrategy(t.id)}
              onClone={() => handleClone(t.id)}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </div>
      )}

      {/* ── Strategies section ──────────────────────────────────────────────── */}
      <SectionHeader
        label="Strategies"
        isCollapsed={strategiesCollapsed}
        onToggle={() => setStrategiesCollapsed((v) => !v)}
        onAdd={handleNewStrategy}
        addTitle="New strategy"
        count={regularStrategies.length}
        accent="blue"
      />

      {!strategiesCollapsed && (
        <div className="flex-1 overflow-y-auto py-1">
          {regularStrategies.length === 0 && (
            <p className="px-3 py-4 text-xs text-text-muted italic">
              No strategies yet.
            </p>
          )}

          {Array.from(groups.entries()).map(([symbol, list]) => {
            const isCollapsed = collapsedGroups.has(symbol);
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
                  <span className={`text-[10px] transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}>
                    ▾
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-text-secondary flex-1 text-left truncate">
                    {symbol}
                  </span>
                  {activeCount > 0 && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                  )}
                  <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                    {list.length}
                  </span>
                </button>

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
      )}
    </aside>
  );
}
