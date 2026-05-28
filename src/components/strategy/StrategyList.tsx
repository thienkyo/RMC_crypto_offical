'use client';

/**
 * StrategyList — left rail with two sections:
 *  1. Templates (collapsible) — pre-defined blueprints, clone to use
 *  2. Strategies (collapsible per symbol) — working strategies grouped by symbol
 *
 * The symbol group header has a "→" clone-group button that copies ALL strategies
 * in that symbol to a different symbol in one action.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  useStrategyStore,
  createDefaultStrategy,
  createDefaultTemplate,
} from '@/store/strategy';
import type { Strategy } from '@/types/strategy';
import { exportToFile, parseImportFile } from '@/lib/strategy/io';
import {
  pushStrategyToDb,
  pushManyStrategiesToDb,
  deleteStrategyFromDb,
  deleteAllStrategiesFromDb,
} from '@/lib/strategy/api';

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

// ── Options popover (⋯ menu on each strategy row) ────────────────────────────

type PopoverView = 'main' | 'clone' | 'merge';

interface OptionsPopoverProps {
  strategy:        Strategy;
  /** Full strategy list — used to derive clone quick-picks and merge candidates. */
  allStrategies:   Strategy[];
  onDuplicate:     () => void;
  onDelete:        () => void;
  onCloneToSymbol: (target: string) => void;
  onMerge:         (sourceIds: string[]) => void;
  onClose:         () => void;
}

function OptionsPopover({
  strategy, allStrategies, onDuplicate, onDelete, onCloneToSymbol, onMerge, onClose,
}: OptionsPopoverProps) {
  const [view,            setView]            = useState<PopoverView>('main');
  const [cloneInput,      setCloneInput]      = useState('');
  const [cloneToast,      setCloneToast]      = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);

  // Click-outside to close
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  // Auto-focus the clone input when that view opens
  useEffect(() => {
    if (view === 'clone') setTimeout(() => cloneInputRef.current?.focus(), 0);
  }, [view]);

  // Merge candidates: same symbol, same direction, not self, not template, exactly 1 entry group
  const mergeEligible = allStrategies.filter(
    (s) =>
      !s.isTemplate &&
      s.id !== strategy.id &&
      s.symbol === strategy.symbol &&
      s.action.type === strategy.action.type &&
      s.entryConditions.length === 1,
  );

  // Symbols that already have strategies (for clone quick-picks)
  const otherSymbols = Array.from(
    new Set(
      allStrategies
        .filter((s) => !s.isTemplate && s.symbol !== strategy.symbol)
        .map((s) => s.symbol),
    ),
  ).sort();

  function commitClone(sym: string) {
    const target = sym.trim().toUpperCase();
    if (!target || target === strategy.symbol) return;
    onCloneToSymbol(target);
    setCloneToast(`Cloned to ${target}`);
    setTimeout(onClose, 1000);
  }

  function toggleSource(id: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function commitMerge() {
    if (selectedSources.size === 0) return;
    onMerge(Array.from(selectedSources));
    onClose();
  }

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full mt-0.5 z-[200] w-52
                 bg-[#0a0e1a] border border-surface-border rounded-md
                 shadow-[0_4px_24px_rgba(0,0,0,0.8)] p-1.5 flex flex-col gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Main view ── */}
      {view === 'main' && (
        <>
          <button type="button" onClick={() => setView('clone')}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded
                       text-text-secondary hover:bg-surface-2 hover:text-accent
                       transition-colors text-left">
            <span className="text-[12px] w-3 text-center">→</span>
            <span className="text-[12px] font-mono">Clone to symbol</span>
          </button>

          <button type="button" onClick={() => { onDuplicate(); onClose(); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded
                       text-text-secondary hover:bg-surface-2 hover:text-accent
                       transition-colors text-left">
            <span className="text-[12px] w-3 text-center">⧉</span>
            <span className="text-[12px] font-mono">Duplicate</span>
          </button>

          <button type="button" onClick={() => setView('merge')}
            disabled={mergeEligible.length === 0}
            title={mergeEligible.length === 0
              ? 'No eligible strategies (need same symbol, 1 group)'
              : `${mergeEligible.length} eligible ${mergeEligible.length === 1 ? 'strategy' : 'strategies'}`}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded
                       text-text-secondary hover:bg-surface-2 hover:text-blue-400
                       transition-colors text-left
                       disabled:opacity-30 disabled:cursor-not-allowed">
            <span className="text-[12px] w-3 text-center">⊕</span>
            <span className="text-[12px] font-mono">Merge into this…</span>
            {mergeEligible.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-text-muted">
                {mergeEligible.length}
              </span>
            )}
          </button>

          <div className="h-px bg-surface-border my-0.5" />

          <button type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${strategy.name}"?`)) { onDelete(); onClose(); }
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded
                       text-text-secondary hover:bg-red-500/10 hover:text-red-400
                       transition-colors text-left">
            <span className="text-[12px] w-3 text-center">🗑</span>
            <span className="text-[12px] font-mono">Delete</span>
          </button>
        </>
      )}

      {/* ── Clone sub-view ── */}
      {view === 'clone' && (
        cloneToast ? (
          <p className="text-[11px] font-mono text-up text-center py-2">{cloneToast}</p>
        ) : (
          <>
            <button type="button" onClick={() => setView('main')}
              className="flex items-center gap-1 text-[10px] font-mono text-text-muted
                         hover:text-text-primary mb-1 transition-colors">
              ‹ back
            </button>
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted px-1 mb-1">
              Clone to…
            </p>
            {otherSymbols.length > 0 && (
              <div className="flex flex-wrap gap-1 px-1 mb-1">
                {otherSymbols.map((sym) => (
                  <button key={sym} type="button" onClick={() => commitClone(sym)}
                    className="px-1.5 py-0.5 rounded border border-surface-border bg-surface-2
                               text-[11px] font-mono text-text-secondary
                               hover:border-accent/50 hover:text-accent hover:bg-accent/5
                               transition-colors">
                    {sym}
                  </button>
                ))}
              </div>
            )}
            {otherSymbols.length > 0 && <div className="h-px bg-surface-border my-1" />}
            <div className="flex gap-1 px-1">
              <input ref={cloneInputRef} type="text" value={cloneInput}
                onChange={(e) => setCloneInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  commitClone(cloneInput);
                  if (e.key === 'Escape') setView('main');
                }}
                placeholder="SOLUSDT…"
                className="flex-1 bg-surface-2 border border-surface-border rounded px-2 py-1
                           text-xs font-mono text-text-primary placeholder:text-text-muted
                           focus:outline-none focus:border-accent/60" />
              <button type="button" onClick={() => commitClone(cloneInput)}
                disabled={!cloneInput.trim()}
                className="px-2 py-1 rounded border border-accent/40 bg-accent/10
                           text-accent text-xs font-mono font-semibold
                           hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed
                           transition-colors">
                →
              </button>
            </div>
          </>
        )
      )}

      {/* ── Merge sub-view ── */}
      {view === 'merge' && (
        <>
          <button type="button"
            onClick={() => { setView('main'); setSelectedSources(new Set()); }}
            className="flex items-center gap-1 text-[10px] font-mono text-text-muted
                       hover:text-text-primary mb-1 transition-colors">
            ‹ back
          </button>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted px-1 mb-1">
            Merge into &ldquo;{strategy.name}&rdquo;
          </p>
          <p className="text-[10px] text-text-muted px-1 mb-1.5 leading-tight">
            Each selected strategy&apos;s group is added as an OR group.
          </p>
          <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
            {mergeEligible.map((src) => (
              <label key={src.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer
                           hover:bg-surface-2 transition-colors select-none">
                <input type="checkbox"
                  checked={selectedSources.has(src.id)}
                  onChange={() => toggleSource(src.id)}
                  className="accent-accent flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-mono text-text-primary truncate">{src.name}</div>
                  <div className="text-[10px] text-text-muted truncate">
                    {src.entryConditions[0]?.label
                      ? `"${src.entryConditions[0].label}"`
                      : `${src.entryConditions[0]?.conditions.length ?? 0} conditions`}
                    {' · '}{src.timeframe}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="h-px bg-surface-border my-1" />
          <button type="button" onClick={commitMerge}
            disabled={selectedSources.size === 0}
            className="w-full py-1.5 rounded bg-blue-500/15 text-blue-400 text-[11px] font-mono
                       hover:bg-blue-500/25 disabled:opacity-30 disabled:cursor-not-allowed
                       transition-colors">
            Merge {selectedSources.size > 0 ? `${selectedSources.size} selected` : ''}
          </button>
        </>
      )}
    </div>
  );
}

// ── Strategy row ──────────────────────────────────────────────────────────────

interface RowProps {
  s:               Strategy;
  active:          boolean;
  /** Full strategy list passed through for the OptionsPopover. */
  allStrategies:   Strategy[];
  onSelect:        () => void;
  onToggle:        () => void;
  onDuplicate:     () => void;
  onDelete:        () => void;
  onCloneToSymbol: (targetSymbol: string) => void;
  onMerge:         (sourceIds: string[]) => void;
}

function StrategyRow({
  s, active, allStrategies, onSelect, onToggle, onDuplicate, onDelete, onCloneToSymbol, onMerge,
}: RowProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);

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
              <span className={`text-[9px] font-bold flex-shrink-0 animate-pulse
                               ${s.action.type === 'enter_long' ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.action.type === 'enter_long' ? '▲' : '▼'}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted font-mono">{s.timeframe}</div>
        </div>

        <div className="flex items-center gap-0.5 ml-1">
          {/* Live monitor toggle — kept outside ⋯ for instant access */}
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

          {/* ⋯ options menu */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOptionsOpen((v) => !v); }}
            className={`btn-icon-xs transition-colors text-[16px] leading-none tracking-tighter ${
              optionsOpen
                ? 'text-accent opacity-100'
                : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-accent'
            }`}
            title="Options"
          >
            ···
          </button>
        </div>
      </div>

      {optionsOpen && (
        <OptionsPopover
          strategy={s}
          allStrategies={allStrategies}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onCloneToSymbol={onCloneToSymbol}
          onMerge={onMerge}
          onClose={() => setOptionsOpen(false)}
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
  const strategies            = useStrategyStore((s) => s.strategies);
  const activeId              = useStrategyStore((s) => s.activeStrategyId);
  const setActiveStrategy     = useStrategyStore((s) => s.setActiveStrategy);
  const deleteStrategy        = useStrategyStore((s) => s.deleteStrategy);
  const upsertStrategy        = useStrategyStore((s) => s.upsertStrategy);
  const toggleStrategyActive  = useStrategyStore((s) => s.toggleStrategyActive);
  const duplicateStrategy     = useStrategyStore((s) => s.duplicateStrategy);
  const copyGroupToSymbol      = useStrategyStore((s) => s.copyGroupToSymbol);
  const cloneStrategyToSymbol  = useStrategyStore((s) => s.cloneStrategyToSymbol);
  const setGroupActive         = useStrategyStore((s) => s.setGroupActive);
  const cloneFromTemplate     = useStrategyStore((s) => s.cloneFromTemplate);
  const loadStarterTemplates  = useStrategyStore((s) => s.loadStarterTemplates);
  const mergeStrategy         = useStrategyStore((s) => s.mergeStrategy);
  const importStrategies      = useStrategyStore((s) => s.importStrategies);
  const clearAllStrategies    = useStrategyStore((s) => s.clearAllStrategies);
  const setStrategies         = useStrategyStore((s) => s.setStrategies);

  const [templatesCollapsed,       setTemplatesCollapsed]       = useState(false);
  const [strategiesCollapsed,      setStrategiesCollapsed]      = useState(false);
  // Symbol groups are collapsed by default — track which ones are EXPANDED
  const [expandedGroups,           setExpandedGroups]           = useState<Set<string>>(new Set());
  // Template direction sub-groups start collapsed
  const [collapsedTplDir, setCollapsedTplDir] = useState<Set<'long' | 'short'>>(new Set(['long', 'short']));
  // Which symbol group's clone popover is open (null = none)
  const [clonePopoverSymbol, setClonePopoverSymbol]   = useState<string | null>(null);
  // Import feedback banner — null = hidden (auto-clears after 3 s)
  const [importFeedback, setImportFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  // True while import is pushing strategies to DB
  const [importing, setImporting]           = useState(false);

  // Pending import: file parsed OK, waiting for user to choose merge vs replace
  const [pendingImport, setPendingImport]   = useState<{ strategies: Strategy[]; count: number } | null>(null);
  // Hidden file input for import
  const importInputRef = useRef<HTMLInputElement>(null);

  /** Show a transient feedback banner for 3 s then auto-dismiss. */
  const showFeedback = useCallback((ok: boolean, msg: string) => {
    setImportFeedback({ ok, msg });
    setTimeout(() => setImportFeedback(null), 3000);
  }, []);


  /** Export all strategies (templates + regulars) to a dated JSON file. */
  function handleExport() {
    if (strategies.length === 0) {
      showFeedback(false, 'Nothing to export — library is empty.');
      return;
    }
    exportToFile(strategies);
    showFeedback(true, `Exported ${strategies.length} ${strategies.length === 1 ? 'strategy' : 'strategies'}.`);
  }

  /** Read the selected .json file; on success, show the merge/replace choice panel. */
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-picked if needed
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text !== 'string') return;
      const result = parseImportFile(text);
      if (!result.ok) {
        showFeedback(false, result.error);
        return;
      }
      // Don't import immediately — show the merge/replace choice first
      setPendingImport({ strategies: result.strategies, count: result.count });
    };
    reader.readAsText(file);
  }

  /** DB-first import: wipe/upsert in DB first, then update localStorage. */
  async function commitImport(mode: 'merge' | 'replace') {
    if (!pendingImport) return;
    setImporting(true);
    try {
      if (mode === 'replace') {
        // Wipe DB before pushing the new set
        await deleteAllStrategiesFromDb();
      }
      // Fan-out push — all strategies to DB in parallel
      const pushed = await pushManyStrategiesToDb(pendingImport.strategies);
      // Update localStorage to match
      const written = importStrategies(pendingImport.strategies, mode);
      setPendingImport(null);
      const label = mode === 'replace' ? 'Replaced library with' : 'Merged';
      const warn  = pushed < written ? ` (${written - pushed} failed to sync to DB)` : '';
      showFeedback(true, `${label} ${written} ${written === 1 ? 'strategy' : 'strategies'}.${warn}`);
    } catch (err) {
      showFeedback(false, `Import failed: ${err instanceof Error ? err.message : 'DB error'}`);
    } finally {
      setImporting(false);
    }
  }

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

  // All unique symbols — quick-picks for the group-level clone-all popover
  const allSymbols = useMemo(
    () => Array.from(new Set(regularStrategies.map((s) => s.symbol))).sort(),
    [regularStrategies],
  );

  function handleNewStrategy() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
    pushStrategyToDb(s).catch((err) =>
      console.warn('[strategy-list:new] DB push failed:', err),
    );
  }

  function handleNewTemplate() {
    const t = createDefaultTemplate();
    upsertStrategy(t);
    setActiveStrategy(t.id);
    setTemplatesCollapsed(false);
    pushStrategyToDb(t).catch((err) =>
      console.warn('[strategy-list:new-template] DB push failed:', err),
    );
  }

  function handleToggle(s: Strategy) {
    // Optimistic — toggle is low-stakes, fire-and-forget DB sync
    toggleStrategyActive(s.id);
    const updated = { ...s, isActive: !(s.isActive ?? false) };
    pushStrategyToDb(updated).catch((err) =>
      console.warn('[strategy-list:toggle] DB sync failed:', err),
    );
  }

  async function handleDelete(s: Strategy) {
    // DB-first: confirm deletion in DB before removing from local store
    try {
      await deleteStrategyFromDb(s.id);
      deleteStrategy(s.id);
    } catch (err) {
      showFeedback(false, `Delete failed: ${err instanceof Error ? err.message : 'DB error'}`);
    }
  }

  return (
    <aside className="w-52 flex-shrink-0 border-r border-surface-border flex flex-col bg-surface">

      {/* ── Library toolbar: Export / Import ────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-surface-border bg-surface-2/50">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none">
          Library
        </span>
        <div className="flex items-center gap-0.5">
          {/* Clear all — DB-first */}
          <button
            type="button"
            onClick={async () => {
              if (strategies.length === 0) return;
              if (!confirm(
                `Clear all ${strategies.length} strategies and templates?\n\nThis permanently deletes them from the database and local storage, including backtest history. Use ↑ Export first if you want a backup.\n\nThis cannot be undone.`
              )) return;
              try {
                await deleteAllStrategiesFromDb();
                clearAllStrategies();
                showFeedback(true, 'Library cleared. Use ↓ to import a backup.');
              } catch (err) {
                showFeedback(false, `Clear failed: ${err instanceof Error ? err.message : 'DB error'}`);
              }
            }}
            title="Clear all strategies and templates"
            className="btn-icon-xs text-text-muted hover:text-red-400 transition-colors text-xs"
          >
            🗑
          </button>

          {/* Export all */}
          <button
            type="button"
            onClick={handleExport}
            title={`Export all ${strategies.length} strategies to JSON`}
            className="btn-icon-xs text-text-muted hover:text-text-primary transition-colors text-xs"
          >
            ↑
          </button>

          {/* Import from file */}
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            title="Import strategies from a JSON file"
            className="btn-icon-xs text-text-muted hover:text-text-primary transition-colors text-xs"
          >
            ↓
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {/* ── Pending import: merge / replace choice ──────────────────────────── */}
      {pendingImport && (
        <div className="px-3 py-2 border-b border-surface-border bg-accent/5 space-y-2">
          {importing ? (
            <p className="text-[11px] font-mono text-text-muted animate-pulse py-1">
              Syncing to database…
            </p>
          ) : (
            <>
              <p className="text-[11px] font-mono text-text-secondary leading-snug">
                Found <span className="text-accent font-semibold">{pendingImport.count}</span> strategies.
                How do you want to import?
              </p>
              <div className="flex gap-1.5">
                {/* Merge — safe default */}
                <button
                  type="button"
                  onClick={() => commitImport('merge')}
                  className="flex-1 py-1 rounded border border-accent/40 bg-accent/10
                             text-accent text-[11px] font-mono font-semibold
                             hover:bg-accent/20 transition-colors"
                  title="Add or update by id — existing strategies not in the file are kept"
                >
                  Merge
                </button>
                {/* Replace — destructive */}
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(
                      `Replace ALL ${strategies.length} existing strategies with the ${pendingImport.count} from the file?\n\nThis deletes everything from the database and local storage, including backtest history. This cannot be undone.`
                    )) return;
                    commitImport('replace');
                  }}
                  className="flex-1 py-1 rounded border border-red-500/40 bg-red-500/10
                             text-red-400 text-[11px] font-mono font-semibold
                             hover:bg-red-500/20 transition-colors"
                  title="Wipe DB and local library, then import"
                >
                  Replace all
                </button>
                <button
                  type="button"
                  onClick={() => setPendingImport(null)}
                  className="px-2 py-1 rounded border border-surface-border
                             text-text-muted text-[11px] font-mono
                             hover:text-text-primary transition-colors"
                  title="Cancel import"
                >
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Import / export feedback banner ─────────────────────────────────── */}
      {importFeedback && (
        <div className={`px-3 py-1.5 text-[11px] font-mono border-b border-surface-border ${
          importFeedback.ok
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border-red-500/20'
        }`}>
          {importFeedback.msg}
        </div>
      )}

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
            onClick={() => {
              const stamped = loadStarterTemplates();
              setTemplatesCollapsed(false);
              // Push to DB so they survive a refresh (fire-and-forget)
              pushManyStrategiesToDb(stamped).catch((err) =>
                console.warn('[strategy-list:load-starters] DB push failed:', err),
              );
            }}
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
            const isCollapsed   = !expandedGroups.has(symbol);
            const activeLongs   = list.filter((s) => (s.isActive ?? false) && s.action.type === 'enter_long').length;
            const activeShorts  = list.filter((s) => (s.isActive ?? false) && s.action.type === 'enter_short').length;
            const anyActive     = activeLongs + activeShorts > 0;
            const popoverOpen   = clonePopoverSymbol === symbol;

            // Sort: longs first then shorts, alphabetically within each group
            const sorted = [...list].sort((a, b) => {
              const aLong = a.action.type === 'enter_long' ? 0 : 1;
              const bLong = b.action.type === 'enter_long' ? 0 : 1;
              if (aLong !== bLong) return aLong - bLong;
              return a.name.localeCompare(b.name);
            });

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
                    {activeLongs > 0 && (
                      <span className="text-[9px] font-bold text-emerald-400 flex-shrink-0 animate-pulse">▲</span>
                    )}
                    {activeShorts > 0 && (
                      <span className="text-[9px] font-bold text-red-400 flex-shrink-0 animate-pulse">▼</span>
                    )}
                    <span className="text-[10px] font-mono text-text-muted flex-shrink-0">
                      {list.length}
                    </span>
                  </button>

                  {/* Toggle-all button — always visible when any active, hover otherwise */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextActive = !anyActive;
                      const updated = list.map((s) => ({ ...s, isActive: nextActive }));
                      setGroupActive(symbol);
                      // Optimistic — fire-and-forget DB sync for each strategy
                      pushManyStrategiesToDb(updated).catch((err) =>
                        console.warn('[strategy-list:group-toggle] DB sync failed:', err),
                      );
                    }}
                    title={anyActive ? 'Turn off all in group' : 'Turn on all in group'}
                    className={`btn-icon-xs flex-shrink-0 transition-colors
                      ${anyActive
                        ? 'text-emerald-400 hover:text-red-400'
                        : 'opacity-0 group-hover/group:opacity-100 text-text-muted hover:text-emerald-400'
                      }`}
                  >
                    ⏻
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
                      const copies = copyGroupToSymbol(symbol, target);
                      setStrategiesCollapsed(false);
                      if (copies.length > 0) pushManyStrategiesToDb(copies).catch((err) =>
                        console.warn('[strategy-list:copy-group] DB push failed:', err),
                      );
                    }}
                    onClose={() => setClonePopoverSymbol(null)}
                  />
                )}

                {/* Strategy rows */}
                {!isCollapsed && sorted.map((s) => (
                  <StrategyRow
                    key={s.id}
                    s={s}
                    active={activeId === s.id}
                    allStrategies={strategies}
                    onSelect={() => setActiveStrategy(s.id)}
                    onToggle={() => handleToggle(s)}
                    onDuplicate={() => {
                      const copy = duplicateStrategy(s.id);
                      if (copy) pushStrategyToDb(copy).catch((err) =>
                        console.warn('[strategy-list:duplicate] DB push failed:', err),
                      );
                    }}
                    onDelete={() => handleDelete(s)}
                    onCloneToSymbol={(target) => {
                      const clone = cloneStrategyToSymbol(s.id, target);
                      if (clone) pushStrategyToDb(clone).catch((err) =>
                        console.warn('[strategy-list:clone-to-symbol] DB push failed:', err),
                      );
                    }}
                    onMerge={(sourceIds) => {
                      const merged = mergeStrategy(sourceIds, s.id);
                      if (merged) pushStrategyToDb(merged).catch((err) =>
                        console.warn('[strategy-list:merge] DB push failed:', err),
                      );
                    }}
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
