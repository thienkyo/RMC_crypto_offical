'use client';

/**
 * StrategyList — left rail with two sections:
 *  1. Templates (collapsible) — pre-defined blueprints, clone to use
 *  2. Strategies (collapsible per symbol) — working strategies grouped by symbol
 *
 * The symbol group header has a "→" clone-group button that copies ALL strategies
 * in that symbol to a different symbol in one action.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  useStrategyStore,
  createDefaultStrategy,
  createDefaultTemplate,
} from '@/store/strategy';
import type { Strategy } from '@/types/strategy';

// ── Template row ──────────────────────────────────────────────────────────────

interface TemplateRowProps {
  s:        Strategy;
  active:   boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function TemplateRow({ s, active, onSelect, onDelete }: TemplateRowProps) {
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

// ── Clone-group-to-symbol popover ─────────────────────────────────────────────

interface CloneGroupPopoverProps {
  /** Symbol whose strategies are being cloned. */
  fromSymbol: string;
  /** All unique symbols already in the store (for quick-picks). */
  allSymbols: string[];
  /** Number of strategies that will be copied. */
  count:      number;
  onClone:    (targetSymbol: string) => void;
  onClose:    () => void;
}

function CloneGroupPopover({ fromSymbol, allSymbols, count, onClone, onClose }: CloneGroupPopoverProps) {
  const [input, setInput]    = useState('');
  const [toast, setToast]    = useState<string | null>(null);
  const inputRef             = useRef<HTMLInputElement>(null);
  const containerRef         = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const otherSymbols = allSymbols.filter((s) => s !== fromSymbol);

  function commit(sym: string) {
    const target = sym.trim().toUpperCase();
    if (!target || target === fromSymbol) return;
    onClone(target);
    setToast(`${count} ${count === 1 ? 'strategy' : 'strategies'} copied to ${target}`);
    // Brief toast then close
    setTimeout(onClose, 1200);
  }

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full mt-1 z-[200] w-56
                 bg-[#0a0e1a] border border-surface-border rounded-md
                 shadow-[0_4px_24px_rgba(0,0,0,0.8)] p-2 flex flex-col gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      {toast ? (
        <p className="text-[11px] font-mono text-up text-center py-1">{toast}</p>
      ) : (
        <>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
            Clone all {count} {count === 1 ? 'strategy' : 'strategies'} to…
          </p>

          {/* Existing symbol quick-picks */}
          {otherSymbols.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {otherSymbols.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => commit(sym)}
                  className="px-2 py-0.5 rounded border border-surface-border bg-surface-2
                             text-[11px] font-mono text-text-secondary
                             hover:border-accent/50 hover:text-accent hover:bg-accent/5
                             transition-colors"
                >
                  {sym}
                </button>
              ))}
            </div>
          )}

          {otherSymbols.length > 0 && <div className="h-px bg-surface-border" />}

          {/* Custom symbol input */}
          <div className="flex gap-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  commit(input);
                if (e.key === 'Escape') onClose();
              }}
              placeholder="SOLUSDT…"
              className="flex-1 bg-surface-2 border border-surface-border rounded px-2 py-1
                         text-xs font-mono text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => commit(input)}
              disabled={!input.trim()}
              className="px-2 py-1 rounded border border-accent/40 bg-accent/10
                         text-accent text-xs font-mono font-semibold
                         hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed
                         transition-colors"
            >
              Clone
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Strategy row ──────────────────────────────────────────────────────────────

interface RowProps {
  s:              Strategy;
  active:         boolean;
  allSymbols:     string[];
  onSelect:       () => void;
  onToggle:       () => void;
  onDuplicate:    () => void;
  onDelete:       () => void;
  onCloneToSymbol:(targetSymbol: string) => void;
}

function StrategyRow({ s, active, allSymbols, onSelect, onToggle, onDuplicate, onDelete, onCloneToSymbol }: RowProps) {
  const [cloneOpen, setCloneOpen] = useState(false);

  return (
    <div className="relative">
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

          {/* Clone to another symbol */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCloneOpen((v) => !v); }}
            className={`btn-icon-xs transition-colors ${
              cloneOpen
                ? 'text-accent opacity-100'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-accent'
            }`}
            title="Clone to another symbol"
          >
            →
          </button>

          {/* Duplicate (same symbol) */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="btn-icon-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary transition-opacity"
            title="Duplicate (same symbol)"
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

      {/* Clone-to-symbol popover */}
      {cloneOpen && (
        <CloneGroupPopover
          fromSymbol={s.symbol}
          allSymbols={allSymbols}
          count={1}
          onClone={(target) => { onCloneToSymbol(target); }}
          onClose={() => setCloneOpen(false)}
        />
      )}
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
          accent === 'violet' ? 'text-violet-400' : 'text-blue-400'
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
  const copyGroupToSymbol    = useStrategyStore((s) => s.copyGroupToSymbol);
  const cloneStrategyToSymbol = useStrategyStore((s) => s.cloneStrategyToSymbol);
  const cloneFromTemplate    = useStrategyStore((s) => s.cloneFromTemplate);
  const loadStarterTemplates = useStrategyStore((s) => s.loadStarterTemplates);

  const [templatesCollapsed,       setTemplatesCollapsed]       = useState(false);
  const [strategiesCollapsed,      setStrategiesCollapsed]      = useState(false);
  // Symbol groups are collapsed by default — track which ones are EXPANDED
  const [expandedGroups,           setExpandedGroups]           = useState<Set<string>>(new Set());
  // Template direction sub-groups start collapsed
  const [collapsedTplDir, setCollapsedTplDir] = useState<Set<'long' | 'short'>>(new Set(['long', 'short']));
  // Which symbol group's clone popover is open (null = none)
  const [clonePopoverSymbol, setClonePopoverSymbol]   = useState<string | null>(null);

  function toggleGroup(symbol: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  const templates         = useMemo(() => strategies.filter((s) => s.isTemplate),   [strategies]);
  const longTemplates     = useMemo(() => templates.filter((t) => t.action.type === 'enter_long'),  [templates]);
  const shortTemplates    = useMemo(() => templates.filter((t) => t.action.type === 'enter_short'), [templates]);
  const regularStrategies = useMemo(() => strategies.filter((s) => !s.isTemplate), [strategies]);

  const groups = useMemo(() => {
    const map = new Map<string, Strategy[]>();
    for (const s of regularStrategies) {
      if (!map.has(s.symbol)) map.set(s.symbol, []);
      map.get(s.symbol)!.push(s);
    }
    return map;
  }, [regularStrategies]);

  // All unique symbols — quick-picks for the clone popover
  const allSymbols = useMemo(
    () => Array.from(new Set(regularStrategies.map((s) => s.symbol))).sort(),
    [regularStrategies],
  );

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

  return (
    <aside className="w-52 flex-shrink-0 border-r border-surface-border flex flex-col bg-surface">
      {/* ── Templates section ───────────────────────────────────────────────── */}
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
            title="Load starter templates"
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
              No templates yet. Click ⬇ to load starters or + to create one.
            </p>
          )}

          {/* ── LONG sub-group ───────────────────────────────────────────── */}
          {longTemplates.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setCollapsedTplDir((prev) => {
                  const next = new Set(prev);
                  next.has('long') ? next.delete('long') : next.add('long');
                  return next;
                })}
                className="w-full flex items-center gap-1.5 px-3 py-1
                           bg-emerald-500/5 hover:bg-emerald-500/10
                           border-b border-surface-border transition-colors select-none"
              >
                <span className={`text-[9px] text-emerald-500 transition-transform duration-150
                                  ${collapsedTplDir.has('long') ? '-rotate-90' : ''}`}>
                  ▾
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  Long
                </span>
                <span className="text-[10px] font-mono text-text-muted">{longTemplates.length}</span>
              </button>
              {!collapsedTplDir.has('long') && longTemplates.map((t) => (
                <TemplateRow
                  key={t.id}
                  s={t}
                  active={activeId === t.id}
                  onSelect={() => setActiveStrategy(t.id)}
                  onDelete={() => handleDelete(t)}
                />
              ))}
            </div>
          )}

          {/* ── SHORT sub-group ──────────────────────────────────────────── */}
          {shortTemplates.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setCollapsedTplDir((prev) => {
                  const next = new Set(prev);
                  next.has('short') ? next.delete('short') : next.add('short');
                  return next;
                })}
                className="w-full flex items-center gap-1.5 px-3 py-1
                           bg-red-500/5 hover:bg-red-500/10
                           border-b border-surface-border transition-colors select-none"
              >
                <span className={`text-[9px] text-red-500 transition-transform duration-150
                                  ${collapsedTplDir.has('short') ? '-rotate-90' : ''}`}>
                  ▾
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">
                  Short
                </span>
                <span className="text-[10px] font-mono text-text-muted">{shortTemplates.length}</span>
              </button>
              {!collapsedTplDir.has('short') && shortTemplates.map((t) => (
                <TemplateRow
                  key={t.id}
                  s={t}
                  active={activeId === t.id}
                  onSelect={() => setActiveStrategy(t.id)}
                  onDelete={() => handleDelete(t)}
                />
              ))}
            </div>
          )}

          {/* Templates that don't fit either direction (e.g. blank user-created) */}
          {templates
            .filter((t) => t.action.type !== 'enter_long' && t.action.type !== 'enter_short')
            .map((t) => (
              <TemplateRow
                key={t.id}
                s={t}
                active={activeId === t.id}
                onSelect={() => setActiveStrategy(t.id)}
                onDelete={() => handleDelete(t)}
              />
            ))
          }
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
            const isCollapsed  = !expandedGroups.has(symbol);
            const activeCount  = list.filter((s) => s.isActive ?? false).length;
            const popoverOpen  = clonePopoverSymbol === symbol;

            return (
              <div key={symbol} className="relative">
                {/* ── Symbol group header ──────────────────────────────── */}
                <div className="group/group flex items-center gap-1.5 px-3 py-1.5
                                text-text-muted hover:text-text-primary hover:bg-surface-2
                                transition-colors select-none">
                  {/* Collapse toggle (takes up all remaining space) */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(symbol)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  >
                    <span className={`text-[10px] transition-transform duration-150 flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>
                      ▾
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-text-secondary truncate">
                      {symbol}
                    </span>
                    {activeCount > 0 && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                    )}
                    <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                      {list.length}
                    </span>
                  </button>

                  {/* Clone-group button — visible on group hover */}
                  <button
                    type="button"
                    onClick={() => setClonePopoverSymbol(popoverOpen ? null : symbol)}
                    title={`Clone all ${list.length} ${list.length === 1 ? 'strategy' : 'strategies'} to another symbol`}
                    className={`btn-icon-xs flex-shrink-0 transition-colors
                      ${popoverOpen
                        ? 'text-accent opacity-100'
                        : 'opacity-0 group-hover/group:opacity-100 text-text-muted hover:text-accent'
                      }`}
                  >
                    →
                  </button>
                </div>

                {/* Clone-group popover */}
                {popoverOpen && (
                  <CloneGroupPopover
                    fromSymbol={symbol}
                    allSymbols={allSymbols}
                    count={list.length}
                    onClone={(target) => {
                      copyGroupToSymbol(symbol, target);
                      setStrategiesCollapsed(false);
                    }}
                    onClose={() => setClonePopoverSymbol(null)}
                  />
                )}

                {/* Strategy rows */}
                {!isCollapsed && list.map((s) => (
                  <StrategyRow
                    key={s.id}
                    s={s}
                    active={activeId === s.id}
                    allSymbols={allSymbols}
                    onSelect={() => setActiveStrategy(s.id)}
                    onToggle={() => handleToggle(s)}
                    onDuplicate={() => duplicateStrategy(s.id)}
                    onDelete={() => handleDelete(s)}
                    onCloneToSymbol={(target) => cloneStrategyToSymbol(s.id, target)}
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
