'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSymbols } from '@/hooks/useSymbols';
import { useChartStore } from '@/store/chart';
import { useChartLayoutStore } from '@/store/chartLayouts';
import { useWatchlistStore } from '@/store/watchlist';
import { useStrategyStore } from '@/store/strategy';
import { useLayoutStore } from '@/store/layout';
import { INDICATORS } from '@/lib/indicators';
import { TIMEFRAMES, type Timeframe, type MarketSymbol, type SymbolSource } from '@/types/market';
import { clsx } from 'clsx';

interface PaletteItem {
  id: string;
  category: 'Symbols' | 'Timeframes' | 'Indicators' | 'Layouts' | 'Strategies' | 'Commands';
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: string;
  action: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Store hooks
  const activeSymbol = useChartStore((s) => s.symbol);
  const activeTimeframe = useChartStore((s) => s.timeframe);
  const activeIndicators = useChartStore((s) => s.activeIndicators);
  const vpConfig = useChartStore((s) => s.vpConfig);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setTimeframe = useChartStore((s) => s.setTimeframe);
  const addIndicator = useChartStore((s) => s.addIndicator);
  const toggleIndicator = useChartStore((s) => s.toggleIndicator);
  const setVpConfig = useChartStore((s) => s.setVpConfig);

  const layouts = useChartLayoutStore((s) => s.layouts);
  const activeLayoutId = useChartLayoutStore((s) => s.activeLayoutId);
  const applyLayout = useChartLayoutStore((s) => s.applyLayout);

  const customSymbols = useWatchlistStore((s) => s.customSymbols);
  const strategies = useStrategyStore((s) => s.strategies);
  const setActiveStrategy = useStrategyStore((s) => s.setActiveStrategy);

  const toggleLeft = useLayoutStore((s) => s.toggleLeft);
  const toggleRight = useLayoutStore((s) => s.toggleRight);

  // Fetch symbols from API
  // `enabled: open` — this component is mounted on every route, so without it a
  // page that never opens the palette still fires /api/symbols (a CoinGecko +
  // Binance sync) purely to fill a hidden list. The cache config lives in the
  // hook, shared with Watchlist, so neither can desync the other's refetching.
  const { data: symbolsData, isError: symbolsError } = useSymbols(open);

  // Global keydown listener for Cmd+K / Ctrl+K and custom event
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };

    const onCustomOpen = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onCustomOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onCustomOpen);
    };
  }, [open]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const goToChart = useCallback(
    (sym?: string, source?: SymbolSource) => {
      if (sym) setSymbol(sym, source);
      if (pathname !== '/') router.push('/');
      close();
    },
    [setSymbol, pathname, router, close],
  );

  // Build searchable items
  const items: PaletteItem[] = useMemo(() => {
    // Mounted on every route, so without this the list is rebuilt — deduping the
    // symbol universe, filtering the whole INDICATORS registry and allocating a
    // closure per row — on every chart-store change, for a component rendering
    // nothing. The hook itself must still run unconditionally.
    if (!open) return [];

    const q = query.trim().toLowerCase();
    const result: PaletteItem[] = [];

    // ── 1. Symbols ──────────────────────────────────────────────
    // Deduped by symbol: the top-20 is rebuilt hourly from rank, so a symbol the
    // user added by hand can later appear in the API list too — two rows with the
    // same id would collide as React keys and desync arrow-key from hover selection.
    const allSymbols: MarketSymbol[] = [...new Map(
      [
        ...(symbolsData?.crypto ?? []),
        ...customSymbols,
        ...(symbolsData?.mag7 ?? symbolsData?.equities ?? []),
        ...(symbolsData?.ai ?? []),
      ].map((sym) => [sym.symbol, sym] as const),
    ).values()];

    const matchedSymbols = (
      q ? allSymbols.filter(
            (s) =>
              s.symbol.toLowerCase().includes(q) ||
              s.baseAsset.toLowerCase().includes(q) ||
              s.displayName.toLowerCase().includes(q),
          )
        : allSymbols.slice(0, 10)
    ).slice(0, 12);

    for (const sym of matchedSymbols) {
      const isCurrent = sym.symbol === activeSymbol;
      result.push({
        id: `sym-${sym.symbol}`,
        category: 'Symbols',
        title: sym.symbol,
        subtitle: `${sym.displayName} (${sym.source === 'equities' ? 'NYSE/NASDAQ' : 'Binance'})`,
        badge: isCurrent ? 'Active' : undefined,
        icon: sym.source === 'equities' ? '📈' : '🪙',
        action: () => goToChart(sym.symbol, sym.source),
      });
    }

    // ── 2. Timeframes ───────────────────────────────────────────
    const tfAliases: Record<string, string[]> = {
      '1m': ['1m', '1', '1 min', 'minute'],
      '5m': ['5m', '5', '5 min'],
      '15m': ['15m', '15', '15 min'],
      '1h': ['1h', '60', '1 hour', 'hourly', 'hour'],
      '4h': ['4h', '240', '4 hour'],
      '1d': ['1d', 'day', 'daily', '1 day'],
      '1w': ['1w', 'week', 'weekly', '1 week'],
    };

    const matchedTfs = TIMEFRAMES.filter((tf) => {
      if (!q) return true;
      const aliases = tfAliases[tf] ?? [tf];
      return aliases.some((a) => a.includes(q) || q.includes(a));
    });

    for (const tf of matchedTfs) {
      const isCurrent = tf === activeTimeframe;
      result.push({
        id: `tf-${tf}`,
        category: 'Timeframes',
        title: `${tf} Timeframe`,
        subtitle: `Switch chart candle resolution to ${tf}`,
        badge: isCurrent ? 'Active' : undefined,
        icon: '⏱️',
        action: () => {
          setTimeframe(tf);
          goToChart();
        },
      });
    }

    // ── 3. Indicators ───────────────────────────────────────────
    // Driven by the INDICATORS registry — the documented single source of truth
    // — so every registered indicator is reachable from here and the params
    // always match what the indicator actually declares. A hand-copied list had
    // already drifted (StochRSI's kSmooth/dSmooth were typed as kPeriod/dPeriod,
    // which produced a silently empty sub-pane).
    const matchedIndicators = Object.values(INDICATORS).filter((ind) =>
      q
        ? ind.id.toLowerCase().includes(q) || ind.name.toLowerCase().includes(q)
        // With no query, show the core indicators rather than burying them under
        // the ~20 candlestick pattern detectors, which `bias` marks out.
        : !ind.bias,
    ).slice(0, 12);

    for (const ind of matchedIndicators) {
      const existing = activeIndicators.find((i) => i.id === ind.id);
      const isVisible = existing?.visible ?? false;
      result.push({
        id: `ind-${ind.id}`,
        category: 'Indicators',
        title: ind.name,
        subtitle: existing ? (isVisible ? 'Active on chart' : 'Hidden') : 'Click to add to chart',
        badge: existing ? (isVisible ? 'Active' : 'Hidden') : 'Off',
        icon: '📊',
        action: () => {
          if (existing) toggleIndicator(ind.id);
          else addIndicator({ id: ind.id, params: ind.defaultParams, visible: true });
          goToChart();
        },
      });
    }

    // The Volume Profile *overlay* is separate from the volume_profile indicator
    // above: it is the histogram drawn on the price pane, driven by vpConfig.
    if (!q || 'volume profile overlay'.includes(q) || 'vp'.includes(q)) {
      const isEnabled = vpConfig.enabled;
      result.push({
        id: 'ind-vp-overlay',
        category: 'Indicators',
        title: 'Volume Profile Overlay',
        subtitle: isEnabled ? 'Currently enabled on the price pane' : 'Click to enable on price chart',
        badge: isEnabled ? 'Active' : 'Off',
        icon: '📊',
        action: () => {
          setVpConfig({ enabled: !isEnabled });
          goToChart();
        },
      });
    }

    // ── 4. Saved Layouts ────────────────────────────────────────
    for (const layout of layouts) {
      if (!q || layout.name.toLowerCase().includes(q)) {
        const isCurrent = layout.id === activeLayoutId;
        result.push({
          id: `layout-${layout.id}`,
          category: 'Layouts',
          title: layout.name,
          subtitle: `Timeframe ${layout.timeframe} · ${layout.activeIndicators.length} indicators${layout.symbol ? ` · (${layout.symbol})` : ''}`,
          badge: isCurrent ? 'Active' : undefined,
          icon: '📁',
          action: () => {
            applyLayout(layout.id);
            goToChart();
          },
        });
      }
    }

    // ── 5. Strategies ───────────────────────────────────────────
    for (const strat of strategies) {
      if (!q || strat.name.toLowerCase().includes(q) || strat.symbol.toLowerCase().includes(q)) {
        result.push({
          id: `strat-${strat.id}`,
          category: 'Strategies',
          title: strat.name,
          subtitle: `${strat.symbol} · ${strat.timeframe} · ${strat.isActive ? 'Active' : 'Paused'}`,
          badge: strat.isActive ? 'Live' : 'Paused',
          icon: '⚡',
          action: () => {
            setActiveStrategy(strat.id);
            router.push('/strategy');
            close();
          },
        });
      }
    }

    // ── 6. Commands ─────────────────────────────────────────────
    const commands = [
      {
        id: 'cmd-toggle-left',
        title: 'Toggle Watchlist Rail',
        subtitle: 'Collapse / expand left panel ( [ )',
        icon: '🖥️',
        match: ['toggle', 'watchlist', 'left', 'rail', '['],
        action: () => { toggleLeft(); close(); },
      },
      {
        id: 'cmd-toggle-right',
        title: 'Toggle AI & News Rail',
        subtitle: 'Collapse / expand right analysis panel ( ] )',
        icon: '🤖',
        match: ['toggle', 'right', 'ai', 'news', 'rail', ']'],
        action: () => { toggleRight(); close(); },
      },
      {
        id: 'cmd-go-chart',
        title: 'Navigate to Chart Page',
        subtitle: 'View primary candlestick terminal',
        icon: '📈',
        match: ['chart', 'home', 'main'],
        action: () => { router.push('/'); close(); },
      },
      {
        id: 'cmd-go-strategy',
        title: 'Navigate to Strategy & Portfolio',
        subtitle: 'Open strategy builder, backtest, and signals feed',
        icon: '⚡',
        match: ['strategy', 'portfolio', 'signals', 'backtest'],
        action: () => { router.push('/strategy'); close(); },
      },
      {
        id: 'cmd-go-settings',
        title: 'Navigate to Settings',
        subtitle: 'Configure Telegram alerts and news sources',
        icon: '⚙️',
        match: ['settings', 'telegram', 'alerts', 'config'],
        action: () => { router.push('/settings'); close(); },
      },
    ];

    for (const cmd of commands) {
      if (!q || cmd.match.some((m) => m.includes(q)) || cmd.title.toLowerCase().includes(q)) {
        result.push({
          id: cmd.id,
          category: 'Commands',
          title: cmd.title,
          subtitle: cmd.subtitle,
          icon: cmd.icon,
          action: cmd.action,
        });
      }
    }

    return result;
  }, [
    query,
    symbolsData,
    customSymbols,
    activeSymbol,
    open,
    activeTimeframe,
    activeIndicators,
    vpConfig,
    layouts,
    activeLayoutId,
    strategies,
    setTimeframe,
    addIndicator,
    toggleIndicator,
    setVpConfig,
    applyLayout,
    setActiveStrategy,
    toggleLeft,
    toggleRight,
    router,
    goToChart,
    close,
  ]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex((idx) => {
      if (items.length === 0) return 0;
      return Math.min(idx, items.length - 1);
    });
  }, [items.length]);

  // Handle keyboard navigation within the list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx + 1) % Math.max(1, items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((idx) => (idx - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[selectedIndex]) {
        items[selectedIndex].action();
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector('[data-selected="true"]');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!open) return null;

  // Group items by category for visual sections
  const groupedItems = items.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    acc[item.category] = acc[item.category] || [];
    acc[item.category]!.push(item);
    return acc;
  }, {});

  let globalIndexCounter = 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-surface-1 border border-surface-border rounded-xl shadow-2xl overflow-hidden font-mono flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Search Input Header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border bg-surface-2">
          <svg
            viewBox="0 0 16 16"
            className="w-4 h-4 text-accent flex-shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l4 4" />
          </svg>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a symbol (BTC), timeframe (15m), indicator (RSI), layout..."
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <kbd className="px-1.5 py-0.5 rounded bg-surface-3 border border-surface-border text-[10px] text-text-muted">
              ESC
            </kbd>
          </div>
        </div>

        {/* ── Scrollable Results ── */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-3">
          {symbolsError && (
            <div className="px-3 py-2 mb-1 rounded border border-down/30 bg-down/10">
              <span className="text-[11px] text-down">
                Symbols failed to load — symbol results are unavailable.
              </span>
            </div>
          )}

          {items.length === 0 ? (
            <div className="py-12 text-center text-xs text-text-muted">
              No matching symbols, timeframes, or commands found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Object.entries(groupedItems).map(([category, catItems]) => (
              <div key={category} className="space-y-1">
                <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {category}
                </div>
                <div className="space-y-0.5">
                  {catItems.map((item) => {
                    const currentIndex = globalIndexCounter++;
                    const isSelected = currentIndex === selectedIndex;

                    return (
                      <div
                        key={item.id}
                        data-selected={isSelected}
                        onClick={item.action}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                        className={clsx(
                          'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors select-none text-xs',
                          isSelected
                            ? 'bg-accent/15 text-accent border-l-2 border-accent'
                            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary border-l-2 border-transparent',
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {item.icon && (
                            <span className="text-sm flex-shrink-0">{item.icon}</span>
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className={clsx('font-medium truncate', isSelected ? 'text-text-primary' : '')}>
                              {item.title}
                            </span>
                            {item.subtitle && (
                              <span className="text-[10px] text-text-muted truncate">
                                {item.subtitle}
                              </span>
                            )}
                          </div>
                        </div>

                        {item.badge && (
                          <span
                            className={clsx(
                              'text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ml-2 font-semibold',
                              item.badge === 'Active' || item.badge === 'Live'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-surface-3 text-text-muted',
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Footer / Shortcuts Bar ── */}
        <div className="px-4 py-2 border-t border-surface-border bg-surface-2 flex items-center justify-between text-[10px] text-text-muted">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-surface-3 rounded border border-surface-border">↑</kbd>{' '}
              <kbd className="px-1 py-0.5 bg-surface-3 rounded border border-surface-border">↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface-3 rounded border border-surface-border">↵</kbd> select
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface-3 rounded border border-surface-border">esc</kbd> close
            </span>
          </div>

          <div className="text-[10px] text-accent/80 font-semibold">
            Cmd+K Omnibar
          </div>
        </div>
      </div>
    </div>
  );
}

