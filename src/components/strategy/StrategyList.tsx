'use client';

/**
 * StrategyList — left rail with two sections:
 *  1. Templates (collapsible) — pre-defined blueprints, clone to use
 *  2. Strategies (collapsible per symbol) — working strategies grouped by symbol
 *
 * The symbol group header has a "→" clone-group button that copies ALL strategies
 * in that symbol to a different symbol in one action.
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import {
  useStrategyStore,
  createDefaultStrategy,
  createDefaultTemplate,
  createDefaultCommonStrategy,
  createDefaultMtfStrategy,
} from '@/store/strategy';
import type { Strategy } from '@/types/strategy';
import { exportToFile, parseImportFile } from '@/lib/strategy/io';
import {
  pushStrategyToDb,
  pushManyStrategiesToDb,
  deleteStrategyFromDb,
  deleteAllStrategiesFromDb,
  syncStrategyToDb,
  syncManyStrategiesToDb,
} from '@/lib/strategy/api';
import { CloneGroupPopover, GroupTopicPopover } from './StrategyPopovers';
import {
  TemplateRow,
  StrategyRow,
  CommonStrategyRow,
  SectionHeader,
} from './StrategyRows';

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
  const setGroupTelegramTopic  = useStrategyStore((s) => s.setGroupTelegramTopic);
  const loadStarterTemplates  = useStrategyStore((s) => s.loadStarterTemplates);
  const mergeStrategy         = useStrategyStore((s) => s.mergeStrategy);
  const importStrategies      = useStrategyStore((s) => s.importStrategies);
  const clearAllStrategies    = useStrategyStore((s) => s.clearAllStrategies);

  const [templatesCollapsed,       setTemplatesCollapsed]       = useState(false);
  const [commonCollapsed,          setCommonCollapsed]          = useState(false);
  const [strategiesCollapsed,      setStrategiesCollapsed]      = useState(false);
  const [mtfCollapsed,             setMtfCollapsed]             = useState(false);
  // Symbol groups: hidden/collapsed by default, separated between regular and MTF
  const [expandedRegularGroups, setExpandedRegularGroups] = useState<Set<string>>(new Set());
  const [expandedMtfGroups, setExpandedMtfGroups]         = useState<Set<string>>(new Set());

  // Template direction sub-groups start collapsed
  const [collapsedTplDir, setCollapsedTplDir] = useState<Set<'long' | 'short'>>(new Set(['long', 'short']));
  // Which symbol group's clone popover is open (null = none, format: "mtf:SYMBOL" or "reg:SYMBOL")
  const [clonePopoverKey, setClonePopoverKey]         = useState<string | null>(null);
  // Which symbol group's telegram topic popover is open (null = none, format: "mtf:SYMBOL" or "reg:SYMBOL")
  const [topicPopoverKey, setTopicPopoverKey]         = useState<string | null>(null);
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

  function toggleRegularGroup(symbol: string) {
    setExpandedRegularGroups((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  function toggleMtfGroup(symbol: string) {
    setExpandedMtfGroups((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  const templates         = useMemo(() => strategies.filter((s) => s.isTemplate),   [strategies]);
  const longTemplates     = useMemo(() => templates.filter((t) => t.action.type === 'enter_long'),  [templates]);
  const shortTemplates    = useMemo(() => templates.filter((t) => t.action.type === 'enter_short'), [templates]);

  const commonStrategies  = useMemo(() => strategies.filter((s) => !s.isTemplate && s.isCommon), [strategies]);
  const regularStrategies = useMemo(() => strategies.filter((s) => !s.isTemplate && !s.isMtf && !s.isCommon), [strategies]);
  const mtfStrategies     = useMemo(() => strategies.filter((s) => !s.isTemplate && s.isMtf && !s.isCommon), [strategies]);

  // All unique symbols — quick-picks for the group-level clone-all popover
  const allSymbols = useMemo(
    () => Array.from(new Set([...regularStrategies, ...mtfStrategies].map((s) => s.symbol))).sort(),
    [regularStrategies, mtfStrategies],
  );

  function handleNewStrategy() {
    const s = createDefaultStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
    syncStrategyToDb(s, 'strategy-list:new');
  }

  function handleNewCommonStrategy() {
    const s = createDefaultCommonStrategy();
    upsertStrategy(s);
    setActiveStrategy(s.id);
    setCommonCollapsed(false);
    syncStrategyToDb(s, 'strategy-list:new-common');
  }

  async function handleConvertToCommon(s: Strategy) {
    const sameNameSiblings = strategies.filter(
      (other) => !other.isTemplate && !other.isCommon && other.id !== s.id && other.name.trim() === s.name.trim(),
    );

    let assignedSymbols = s.symbols && s.symbols.length > 0 ? [...s.symbols] : [s.symbol];
    let toDeleteIds: string[] = [];

    if (sameNameSiblings.length > 0) {
      const siblingSymbols = Array.from(new Set(sameNameSiblings.map((x) => x.symbol)));
      const shouldMerge = confirm(
        `Found ${sameNameSiblings.length} other strategies with the same name "${s.name}" on:\n` +
        siblingSymbols.join(', ') +
        `\n\nMerge all of them into this single Common Strategy and delete the duplicate copies?`,
      );

      if (!shouldMerge) {
        return;
      }

      assignedSymbols = Array.from(new Set([...assignedSymbols, ...siblingSymbols]));
      toDeleteIds = sameNameSiblings.map((x) => x.id);
    } else {
      const shouldConvert = confirm(
        `Convert "${s.name}" into a Common Strategy shared across multiple tickers?`,
      );
      if (!shouldConvert) {
        return;
      }
    }

    const updatedCommon: Strategy = {
      ...s,
      isCommon: true,
      symbols: assignedSymbols,
      version: s.version + 1,
      updatedAt: Date.now(),
    };

    try {
      for (const delId of toDeleteIds) {
        await deleteStrategyFromDb(delId).catch(console.warn);
        deleteStrategy(delId);
      }
      await pushStrategyToDb(updatedCommon);
      upsertStrategy(updatedCommon);
      setActiveStrategy(updatedCommon.id);
      setCommonCollapsed(false);
      showFeedback(true, `Converted "${s.name}" to Common Strategy (${assignedSymbols.length} tickers)!`);
    } catch (err) {
      showFeedback(false, `Failed to convert: ${err instanceof Error ? err.message : 'DB error'}`);
    }
  }

  function handleNewMtfStrategy() {
    const mtf = createDefaultMtfStrategy();
    upsertStrategy(mtf);
    setActiveStrategy(mtf.id);
    syncStrategyToDb(mtf, 'strategy-list:new-mtf');
  }

  function handleNewTemplate() {
    const t = createDefaultTemplate();
    upsertStrategy(t);
    setActiveStrategy(t.id);
    setTemplatesCollapsed(false);
    syncStrategyToDb(t, 'strategy-list:new-template');
  }

  function handleToggle(s: Strategy) {
    // Optimistic — toggle is low-stakes, fire-and-forget DB sync
    toggleStrategyActive(s.id);
    const updated = { ...s, isActive: !(s.isActive ?? false) };
    syncStrategyToDb(updated, 'strategy-list:toggle');
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
              syncManyStrategiesToDb(stamped, 'strategy-list:load-starters');
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
              {!collapsedTplDir.has('long') && (
                <div className="border-l-2 border-emerald-500/40 ml-4 my-0.5 space-y-0.5">
                  {longTemplates.map((t) => (
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
              {!collapsedTplDir.has('short') && (
                <div className="border-l-2 border-red-500/40 ml-4 my-0.5 space-y-0.5">
                  {shortTemplates.map((t) => (
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

      {/* ── Common Strategies section ────────────────────────────────────────── */}
      <SectionHeader
        label="Common Strategies"
        isCollapsed={commonCollapsed}
        onToggle={() => setCommonCollapsed((v) => !v)}
        onAdd={handleNewCommonStrategy}
        addTitle="New common strategy (shared across tickers)"
        count={commonStrategies.length}
        accent="violet"
      />
      {!commonCollapsed && (
        <div className="py-1 border-b border-surface-border max-h-56 overflow-y-auto">
          {commonStrategies.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted italic">
              No common strategies yet. Click + or use &quot;Convert to Common&quot; on any strategy.
            </p>
          ) : (
            <div className="border-l-2 border-purple-500/40 ml-4 my-0.5 space-y-0.5">
              {commonStrategies.map((cs) => (
                <CommonStrategyRow
                  key={cs.id}
                  s={cs}
                  active={activeId === cs.id}
                  allStrategies={strategies}
                  onSelect={() => setActiveStrategy(cs.id)}
                  onToggle={() => handleToggle(cs)}
                  onDuplicate={() => {
                    const copy = duplicateStrategy(cs.id);
                    syncStrategyToDb(copy, 'common-duplicate');
                  }}
                  onDelete={() => handleDelete(cs)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MTF Strategies section ──────────────────────────────────────────── */}
      <SectionHeader
        label="MTF Strategies"
        isCollapsed={mtfCollapsed}
        onToggle={() => setMtfCollapsed((v) => !v)}
        onAdd={handleNewMtfStrategy}
        addTitle="New MTF strategy"
        count={mtfStrategies.length}
        accent="cyan"
      />
      {!mtfCollapsed && (
        <div className="py-1 border-b border-surface-border max-h-56 overflow-y-auto">
          <SymbolGroupList
            isMtf={true}
            strategies={mtfStrategies}
            allStrategies={strategies}
            expandedGroups={expandedMtfGroups}
            toggleGroup={toggleMtfGroup}
            clonePopoverKey={clonePopoverKey}
            setClonePopoverKey={setClonePopoverKey}
            topicPopoverKey={topicPopoverKey}
            setTopicPopoverKey={setTopicPopoverKey}
            activeId={activeId}
            setActiveStrategy={setActiveStrategy}
            handleToggle={handleToggle}
            handleDelete={handleDelete}
            duplicateStrategy={duplicateStrategy}
            cloneStrategyToSymbol={cloneStrategyToSymbol}
            mergeStrategy={mergeStrategy}
            onConvertToCommon={handleConvertToCommon}
            setGroupActive={setGroupActive}
            setGroupTelegramTopic={setGroupTelegramTopic}
            copyGroupToSymbol={copyGroupToSymbol}
            setStrategiesCollapsed={setMtfCollapsed}
            allSymbols={allSymbols}
          />
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
          <SymbolGroupList
            isMtf={false}
            strategies={regularStrategies}
            allStrategies={strategies}
            expandedGroups={expandedRegularGroups}
            toggleGroup={toggleRegularGroup}
            clonePopoverKey={clonePopoverKey}
            setClonePopoverKey={setClonePopoverKey}
            topicPopoverKey={topicPopoverKey}
            setTopicPopoverKey={setTopicPopoverKey}
            activeId={activeId}
            setActiveStrategy={setActiveStrategy}
            handleToggle={handleToggle}
            handleDelete={handleDelete}
            duplicateStrategy={duplicateStrategy}
            cloneStrategyToSymbol={cloneStrategyToSymbol}
            mergeStrategy={mergeStrategy}
            onConvertToCommon={handleConvertToCommon}
            setGroupActive={setGroupActive}
            setGroupTelegramTopic={setGroupTelegramTopic}
            copyGroupToSymbol={copyGroupToSymbol}
            setStrategiesCollapsed={setStrategiesCollapsed}
            allSymbols={allSymbols}
          />
        </div>
      )}
    </aside>
  );
}

// ── Symbol group component ───────────────────────────────────────────────────

interface SymbolGroupListProps {
  isMtf: boolean;
  strategies: Strategy[];
  allStrategies: Strategy[];
  expandedGroups: Set<string>;
  toggleGroup: (symbol: string) => void;
  clonePopoverKey: string | null;
  setClonePopoverKey: (key: string | null) => void;
  topicPopoverKey: string | null;
  setTopicPopoverKey: (key: string | null) => void;
  activeId: string | null;
  setActiveStrategy: (id: string) => void;
  handleToggle: (s: Strategy) => void;
  handleDelete: (s: Strategy) => void;
  duplicateStrategy: (id: string) => Strategy | undefined;
  cloneStrategyToSymbol: (id: string, target: string) => Strategy | undefined;
  mergeStrategy: (sources: string[], dest: string) => Strategy | undefined;
  onConvertToCommon?: (s: Strategy) => void;
  setGroupActive: (symbol: string, active?: boolean, isMtf?: boolean) => void;
  setGroupTelegramTopic: (symbol: string, topic: { enabled: boolean; name: string }, isMtf?: boolean) => Strategy[];
  copyGroupToSymbol: (symbol: string, target: string, isMtf?: boolean) => Strategy[];
  setStrategiesCollapsed: (b: boolean) => void;
  allSymbols: string[];
}

function SymbolGroupList({
  isMtf, strategies, allStrategies, expandedGroups, toggleGroup, clonePopoverKey, setClonePopoverKey,
  topicPopoverKey, setTopicPopoverKey, activeId, setActiveStrategy, handleToggle, handleDelete,
  duplicateStrategy, cloneStrategyToSymbol, mergeStrategy, onConvertToCommon, setGroupActive, setGroupTelegramTopic,
  copyGroupToSymbol, setStrategiesCollapsed, allSymbols
}: SymbolGroupListProps) {
  const groups = useMemo(() => {
    const map = new Map<string, Strategy[]>();
    for (const s of strategies) {
      if (!map.has(s.symbol)) map.set(s.symbol, []);
      map.get(s.symbol)!.push(s);
    }
    return map;
  }, [strategies]);

  if (strategies.length === 0) {
    return <p className="px-3 py-4 text-xs text-text-muted italic">No strategies yet.</p>;
  }

  return (
    <>
      {Array.from(groups.entries()).map(([symbol, list]) => {
        const groupKey          = `${isMtf ? 'mtf' : 'reg'}:${symbol}`;
        const isCollapsed       = !expandedGroups.has(symbol);
        const activeLongs       = list.filter((s) => (s.isActive ?? false) && s.action.type === 'enter_long').length;
        const activeShorts      = list.filter((s) => (s.isActive ?? false) && s.action.type === 'enter_short').length;
        const anyActive         = activeLongs + activeShorts > 0;
        const popoverOpen       = clonePopoverKey === groupKey;
        const topicPopoverOpen  = topicPopoverKey === groupKey;
        const enabledTopics     = list.filter((s) => s.telegramTopic?.enabled);
        const hasTopicEnabled   = enabledTopics.length > 0;
        const firstTopicName    = enabledTopics.find((s) => s.telegramTopic?.name)?.telegramTopic?.name ||
                                  list.find((s) => s.telegramTopic?.name)?.telegramTopic?.name || symbol;

        const sorted = [...list].sort((a, b) => {
          const aLong = a.action.type === 'enter_long' ? 0 : 1;
          const bLong = b.action.type === 'enter_long' ? 0 : 1;
          if (aLong !== bLong) return aLong - bLong;
          return a.name.localeCompare(b.name);
        });

        return (
          <div key={symbol} className="relative mb-0.5">
            <div
              className={`group/group sticky top-0 z-10 flex items-center gap-1.5 px-2.5 py-1.5
                          bg-surface-2/95 hover:bg-surface-3 border-y border-surface-border/80
                          border-l-2 ${isMtf ? 'border-l-cyan-400' : 'border-l-amber-400'}
                          transition-colors select-none`}
            >
              <button
                type="button"
                onClick={() => toggleGroup(symbol)}
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
              >
                <span className={`text-[10px] text-text-secondary transition-transform duration-150 flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>
                  ▾
                </span>
                <span className={`text-xs font-mono font-bold tracking-wide truncate ${
                  isMtf ? 'text-cyan-300' : 'text-amber-300'
                }`}>
                  {symbol}
                </span>
                {activeLongs > 0 && <span className="text-[9px] font-bold text-emerald-400 flex-shrink-0 animate-pulse">▲</span>}
                {activeShorts > 0 && <span className="text-[9px] font-bold text-red-400 flex-shrink-0 animate-pulse">▼</span>}
                <span className="px-1.5 py-px rounded bg-surface-3 text-[10px] font-mono font-semibold text-text-secondary flex-shrink-0">
                  {list.length}
                </span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const nextActive = !anyActive;
                  const updated = list.map((s) => ({ ...s, isActive: nextActive }));
                  setGroupActive(symbol, nextActive, isMtf);
                  syncManyStrategiesToDb(updated, 'group-toggle');
                }}
                title={anyActive ? 'Turn off all in group' : 'Turn on all in group'}
                className={`btn-icon-xs flex-shrink-0 transition-colors
                  ${anyActive ? 'text-emerald-400 hover:text-red-400' : 'opacity-0 group-hover/group:opacity-100 text-text-muted hover:text-emerald-400'}`}
              >
                ⏻
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTopicPopoverKey(topicPopoverOpen ? null : groupKey);
                  if (clonePopoverKey) setClonePopoverKey(null);
                }}
                title={
                  hasTopicEnabled
                    ? `Telegram topic: #${firstTopicName} (${enabledTopics.length}/${list.length} on)`
                    : `Set Telegram topic for ${symbol} group (${list.length} strategies)`
                }
                className={`btn-icon-xs flex-shrink-0 transition-colors ${
                  hasTopicEnabled
                    ? 'text-sky-400 hover:text-sky-300 opacity-90 hover:opacity-100'
                    : topicPopoverOpen
                    ? 'text-sky-400 opacity-100'
                    : 'opacity-0 group-hover/group:opacity-100 text-text-muted hover:text-sky-400'
                }`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setClonePopoverKey(popoverOpen ? null : groupKey);
                  if (topicPopoverKey) setTopicPopoverKey(null);
                }}
                title={`Clone all ${list.length} to another symbol`}
                className={`btn-icon-xs flex-shrink-0 transition-colors
                  ${popoverOpen ? 'text-accent opacity-100' : 'opacity-0 group-hover/group:opacity-100 text-text-muted hover:text-accent'}`}
              >
                →
              </button>
            </div>
            {popoverOpen && (
              <CloneGroupPopover
                fromSymbol={symbol}
                allSymbols={allSymbols}
                count={list.length}
                onClone={(target) => {
                  const copies = copyGroupToSymbol(symbol, target, isMtf);
                  setStrategiesCollapsed(false);
                  syncManyStrategiesToDb(copies, 'copy-group');
                }}
                onClose={() => setClonePopoverKey(null)}
              />
            )}
            {topicPopoverOpen && (
              <GroupTopicPopover
                symbol={symbol}
                count={list.length}
                initialTopic={{
                  enabled: hasTopicEnabled || true,
                  name: firstTopicName,
                }}
                onApply={(topic) => {
                  const updated = setGroupTelegramTopic(symbol, topic, isMtf);
                  syncManyStrategiesToDb(updated, 'group-topic');
                }}
                onClose={() => setTopicPopoverKey(null)}
              />
            )}
            {!isCollapsed && (
              <div className={`border-l-2 ${isMtf ? 'border-l-cyan-500/40' : 'border-l-amber-500/40'} ml-4 my-0.5 space-y-0.5`}>
                {sorted.map((s) => (
                  <StrategyRow
                    key={s.id}
                    s={s}
                    active={activeId === s.id}
                    allStrategies={allStrategies}
                    onSelect={() => setActiveStrategy(s.id)}
                    onToggle={() => handleToggle(s)}
                    onDuplicate={() => {
                      const copy = duplicateStrategy(s.id);
                      syncStrategyToDb(copy, 'duplicate');
                    }}
                    onDelete={() => handleDelete(s)}
                    onCloneToSymbol={(target) => {
                      const clone = cloneStrategyToSymbol(s.id, target);
                      syncStrategyToDb(clone, 'clone-to-symbol');
                    }}
                    onMerge={(sourceIds) => {
                      const merged = mergeStrategy(sourceIds, s.id);
                      syncStrategyToDb(merged, 'merge');
                    }}
                    onConvertToCommon={onConvertToCommon ? () => onConvertToCommon(s) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
