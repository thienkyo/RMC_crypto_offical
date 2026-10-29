'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useSymbols } from '@/hooks/useSymbols';
import { useChartStore } from '@/store/chart';
import { useWatchlistStore } from '@/store/watchlist';
import type { MarketSymbol } from '@/types/market';
import { clsx } from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
}

type FilterTab = 'all' | 'crypto' | 'equities' | 'favorites';

export function SymbolSearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeSymbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);

  const favoriteSymbols = useWatchlistStore((s) => s.favoriteSymbols);
  const customSymbols = useWatchlistStore((s) => s.customSymbols);

  const { data: symbolsData, isLoading } = useSymbols(open);

  // Combine all symbols and deduplicate strictly by source + symbol
  const allSymbols = useMemo(() => {
    if (!symbolsData) return [];
    const raw = [
      ...(symbolsData.crypto || []),
      ...(symbolsData.mag7 || []),
      ...(symbolsData.ai || []),
      ...(symbolsData.equities || []),
      ...customSymbols,
    ];

    const seen = new Set<string>();
    const result: MarketSymbol[] = [];
    for (const item of raw) {
      const key = `${item.source}-${item.symbol}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }, [symbolsData, customSymbols]);

  // Filter symbols based on tab & search query
  const filteredSymbols = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSymbols.filter((item) => {
      // Tab filter
      if (tab === 'crypto' && item.source !== 'binance') return false;
      if (tab === 'equities' && item.source !== 'equities') return false;
      if (tab === 'favorites' && !favoriteSymbols.includes(item.symbol)) return false;

      // Query filter
      if (!q) return true;
      return (
        item.symbol.toLowerCase().includes(q) ||
        (item.baseAsset?.toLowerCase().includes(q) ?? false) ||
        (item.displayName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [allSymbols, tab, query, favoriteSymbols]);

  // Global ESC key to close modal reliably from anywhere
  useEffect(() => {
    if (!open) return;
    const handleGlobalEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalEsc);
    return () => window.removeEventListener('keydown', handleGlobalEsc);
  }, [open, onClose]);

  // Auto-focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredSymbols.length, tab]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredSymbols.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredSymbols.length) % Math.max(1, filteredSymbols.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredSymbols[selectedIndex];
      if (target) {
        setSymbol(target.symbol, target.source);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface border border-surface-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border bg-surface-2">
          <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol or name (e.g. BTC, ETH, SOL, AAPL, NVDA)..."
            className="flex-1 bg-transparent text-sm font-mono text-text-primary placeholder:text-text-muted outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              ✕
            </button>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-surface-border text-text-muted">
            ESC
          </span>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-border/60 bg-surface text-xs">
          {(['all', 'crypto', 'equities', 'favorites'] as FilterTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={clsx(
                'px-2.5 py-1 rounded-md capitalize font-mono text-[11px] transition-colors',
                tab === t
                  ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-2',
              )}
            >
              {t === 'favorites' ? '★ Favorites' : t}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono text-text-muted">
            {filteredSymbols.length} results
          </span>
        </div>

        {/* Symbols List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-1.5 divide-y divide-surface-border/20">
          {isLoading && filteredSymbols.length === 0 ? (
            <div className="py-12 text-center text-xs text-text-muted animate-pulse">
              Loading symbol universe…
            </div>
          ) : filteredSymbols.length === 0 ? (
            <div className="py-12 text-center text-xs text-text-muted">
              No symbols found for &quot;{query}&quot;
            </div>
          ) : (
            filteredSymbols.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const isCurrent = item.symbol === activeSymbol;
              const isFav = favoriteSymbols.includes(item.symbol);

              return (
                <div
                  key={`${item.source}-${item.symbol}`}
                  onClick={() => {
                    setSymbol(item.symbol, item.source);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={clsx(
                    'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                    isSelected ? 'bg-surface-2 border border-surface-border' : 'hover:bg-surface-2/60 border border-transparent',
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={clsx(
                        'text-xs font-mono font-bold tracking-wide truncate',
                        isCurrent ? 'text-accent' : 'text-text-primary',
                      )}
                    >
                      {item.symbol}
                    </span>
                    <span className="text-[11px] text-text-muted truncate max-w-[180px]">
                      {item.displayName}
                    </span>
                    {isFav && <span className="text-yellow-400 text-xs">★</span>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={clsx(
                        'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border',
                        item.source === 'equities'
                          ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
                          : 'text-amber-400 border-amber-500/30 bg-amber-500/10',
                      )}
                    >
                      {item.source === 'equities' ? 'US Cash' : 'Spot'}
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-mono text-accent">Active</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-surface-border bg-surface-2/60 flex items-center justify-between text-[10px] font-mono text-text-muted">
          <span>↑↓ Navigate · Enter to Select</span>
          <span>Tip: Press / to open anywhere on chart</span>
        </div>
      </div>
    </div>
  );
}
