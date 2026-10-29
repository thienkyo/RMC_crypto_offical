'use client';

/**
 * StrategyList Popover Components:
 * - CloneGroupPopover: Clone all strategies in a symbol group to another symbol
 * - GroupTopicPopover: Configure Telegram topic routing for an entire symbol group
 * - OptionsPopover: Per-strategy options menu (Clone to symbol, Duplicate, Merge, Convert to Common, Delete)
 */

import { useState, useRef, useEffect } from 'react';
import type { Strategy } from '@/types/strategy';

// ── Clone-group-to-symbol popover ─────────────────────────────────────────────

export interface CloneGroupPopoverProps {
  /** Symbol whose strategies are being cloned. */
  fromSymbol: string;
  /** All unique symbols already in the store (for quick-picks). */
  allSymbols: string[];
  /** Number of strategies that will be copied. */
  count:      number;
  onClone:    (targetSymbol: string) => void;
  onClose:    () => void;
}

export function CloneGroupPopover({
  fromSymbol,
  allSymbols,
  count,
  onClone,
  onClose,
}: CloneGroupPopoverProps) {
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

// ── Group Telegram topic popover ─────────────────────────────────────────────

export interface GroupTopicPopoverProps {
  symbol: string;
  count: number;
  initialTopic?: { enabled: boolean; name: string };
  onApply: (topic: { enabled: boolean; name: string }) => void;
  onClose: () => void;
}

export function GroupTopicPopover({
  symbol,
  count,
  initialTopic,
  onApply,
  onClose,
}: GroupTopicPopoverProps) {
  const [enabled, setEnabled] = useState(initialTopic?.enabled ?? true);
  const [name, setName]       = useState(initialTopic?.name || symbol);
  const [toast, setToast]     = useState<string | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const containerRef          = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enabled) {
      inputRef.current?.focus();
    }
  }, [enabled]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  function commit() {
    const finalTopic = {
      enabled,
      name: (name.trim() || symbol).substring(0, 128),
    };
    onApply(finalTopic);
    setToast(
      enabled
        ? `Topic #${finalTopic.name} set for all ${count} strategies`
        : `Topic routing disabled for all ${count} strategies`,
    );
    setTimeout(onClose, 1100);
  }

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full mt-1 z-[200] w-64
                 bg-[#0a0e1a] border border-surface-border rounded-md
                 shadow-[0_4px_24px_rgba(0,0,0,0.8)] p-3 flex flex-col gap-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      {toast ? (
        <p className="text-[11px] font-mono text-emerald-400 text-center py-2">{toast}</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-text-primary">
            <svg className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
            </svg>
            <span className="text-[11px] font-mono font-semibold">Group Telegram Topic</span>
          </div>

          <p className="text-[10px] text-text-muted leading-tight">
            Apply Telegram topic routing to all <span className="text-text-primary font-mono font-semibold">{count}</span> {symbol} strategies.
          </p>

          <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                enabled ? 'bg-sky-500' : 'bg-surface-border'
              }`}
            >
              <span
                className={`block w-3 h-3 rounded-full bg-white shadow transition-transform mx-0.5 ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-[11px] font-mono text-text-secondary">
              {enabled ? 'Send to Telegram Topic' : 'General Chat (No topic)'}
            </span>
          </label>

          {enabled && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-mono text-text-muted">Topic Name</span>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.substring(0, 128))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') onClose();
                }}
                placeholder={symbol}
                className="bg-surface-2 border border-surface-border rounded px-2 py-1
                           text-xs font-mono text-text-primary placeholder:text-text-muted
                           focus:outline-none focus:border-sky-500/70"
              />
              <span className="text-[9px] text-text-muted font-mono">
                Will route to topic #{name.trim() || symbol}
              </span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-[11px] font-mono text-text-muted hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="px-2.5 py-1 rounded border border-sky-500/50 bg-sky-500/15
                         text-sky-400 text-[11px] font-mono font-semibold
                         hover:bg-sky-500/25 transition-colors"
            >
              Apply to all {count}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Options popover (⋯ menu on each strategy row) ────────────────────────────

type PopoverView = 'main' | 'clone' | 'merge';

export interface OptionsPopoverProps {
  strategy:        Strategy;
  /** Full strategy list — used to derive clone quick-picks and merge candidates. */
  allStrategies:   Strategy[];
  onDuplicate:     () => void;
  onDelete:        () => void;
  onCloneToSymbol: (target: string) => void;
  onMerge:         (sourceIds: string[]) => void;
  onConvertToCommon?: () => void;
  onClose:         () => void;
}

export function OptionsPopover({
  strategy,
  allStrategies,
  onDuplicate,
  onDelete,
  onCloneToSymbol,
  onMerge,
  onConvertToCommon,
  onClose,
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

          {!strategy.isCommon && onConvertToCommon && (
            <button type="button"
              onClick={() => { onConvertToCommon(); onClose(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded
                         text-text-secondary hover:bg-purple-500/10 hover:text-purple-300
                         transition-colors text-left"
            >
              <span className="text-[12px] w-3 text-center">🔗</span>
              <span className="text-[12px] font-mono">Convert to Common</span>
            </button>
          )}

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
