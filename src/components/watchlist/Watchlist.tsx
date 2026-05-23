'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery }         from '@tanstack/react-query';
import { useChartStore }    from '@/store/chart';
import { useWatchlistStore } from '@/store/watchlist';
import { subscribeTicker }  from '@/lib/exchange/binance';
import { clsx }             from 'clsx';
import type { MarketSymbol } from '@/types/market';

// ── API shapes ────────────────────────────────────────────────────────────────

interface SymbolsResponse {
  crypto:   MarketSymbol[];
  equities: MarketSymbol[];
  stale?:   boolean;
}

type ValidateResponse =
  | { valid: true;  symbol: string; price: number; marketSymbol: MarketSymbol }
  | { valid: false; reason: string };

// ── Sub-components ────────────────────────────────────────────────────────────

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-3 h-3" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
      <path d="M8 1.5l1.647 3.758 4.103.597-2.969 2.892.7 4.082L8 10.75l-3.481 1.83.7-4.083L2.25 5.855l4.103-.597L8 1.5z" />
    </svg>
  );
}

interface TickerState {
  price:     number;
  changePct: number;
  flashing:  boolean;
}

interface RowProps {
  item:        MarketSymbol;
  isActive:    boolean;
  isCustom:    boolean;
  isFavorited: boolean;
  ticker:      TickerState | undefined;
  /** Favorites-section rows omit the remove button (remove via star in main section). */
  isFavSection: boolean;
  onSelect:     () => void;
  onToggleFav:  (e: React.MouseEvent) => void;
  onRemove:     (e: React.MouseEvent) => void;
}

function SymbolRow({
  item, isActive, isCustom, isFavorited, ticker,
  isFavSection, onSelect, onToggleFav, onRemove,
}: RowProps) {
  const changePct = ticker?.changePct ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={clsx(
        'w-full flex items-center px-1 py-1.5 cursor-pointer group select-none',
        'transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        isActive
          ? 'bg-accent/10 border-l-2 border-accent'
          : 'hover:bg-surface-3 border-l-2 border-transparent',
      )}
    >
      {/* ── Star ── */}
      <button
        onClick={onToggleFav}
        title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        className={clsx(
          'flex-shrink-0 w-5 h-5 flex items-center justify-center rounded',
          'transition-colors focus:outline-none',
          isFavorited
            ? 'text-yellow-400'
            : 'text-text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-yellow-400',
        )}
      >
        <StarIcon filled={isFavorited} />
      </button>

      {/* ── Name + display name ── */}
      <div className="flex flex-col min-w-0 flex-1 ml-1">
        <div className="flex items-center gap-1">
          <span
            className={clsx(
              'text-[12px] font-mono font-semibold truncate',
              isActive ? 'text-accent' : 'text-text-primary',
            )}
          >
            {item.baseAsset}
          </span>
          {isCustom && (
            <span className="text-[9px] text-accent/70 font-mono border border-accent/30
                             rounded px-0.5 leading-tight flex-shrink-0">
              +
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-muted truncate">{item.displayName}</span>
      </div>

      {/* ── Price / change ── */}
      <div className="flex flex-col items-end flex-shrink-0 ml-1">
        {ticker ? (
          <>
            <span
              className={clsx(
                'text-[11px] font-mono transition-colors',
                ticker.flashing
                  ? changePct >= 0 ? 'text-up' : 'text-down'
                  : 'text-text-price',
              )}
            >
              {ticker.price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: ticker.price < 1 ? 6 : 2,
              })}
            </span>
            <span className={clsx('text-[10px] font-mono', changePct >= 0 ? 'text-up' : 'text-down')}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="text-[10px] text-text-muted">—</span>
        )}
      </div>

      {/* ── Remove (×) — hidden for favorites section ── */}
      {!isFavSection ? (
        <button
          onClick={onRemove}
          title={isCustom ? 'Remove from watchlist' : 'Hide from watchlist'}
          className="flex-shrink-0 w-4 h-4 ml-0.5 flex items-center justify-center
                     text-text-muted opacity-0 group-hover:opacity-60
                     hover:!opacity-100 hover:text-red-400
                     transition-colors text-[13px] leading-none focus:outline-none"
        >
          ×
        </button>
      ) : (
        // Spacer to keep alignment identical
        <div className="flex-shrink-0 w-4 ml-0.5" />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/** Left-rail watchlist with live Binance price ticks, favorites, and symbol management. */
export function Watchlist() {
  const symbol    = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);

  const {
    hiddenSymbols, customSymbols, favoriteSymbols,
    hideSymbol, showSymbol, addCustomSymbol, removeCustomSymbol, toggleFavorite,
  } = useWatchlistStore();

  const { data, isLoading } = useQuery<SymbolsResponse>({
    queryKey:        ['symbols'],
    queryFn:         () => fetch('/api/symbols').then((r) => r.json()),
    staleTime:       3_600_000,
    refetchInterval: 3_600_000,
  });

  // ── Live tickers ──────────────────────────────────────────────────────────
  const [tickers, setTickers] = useState<Record<string, TickerState>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateTicker = useCallback((sym: string, price: number, changePct: number) => {
    setTickers((prev) => ({ ...prev, [sym]: { price, changePct, flashing: true } }));
    clearTimeout(flashTimers.current[sym]);
    flashTimers.current[sym] = setTimeout(() => {
      setTickers((prev) => ({
        ...prev,
        [sym]: prev[sym]
          ? { ...prev[sym]!, flashing: false }
          : { price, changePct, flashing: false },
      }));
    }, 400);
  }, []);

  // Subscribe to all crypto (default list + user-added)
  useEffect(() => {
    const allCrypto = [
      ...(data?.crypto ?? []),
      ...customSymbols.filter((s) => s.source === 'binance'),
    ];
    if (allCrypto.length === 0) return;
    const unsubs = allCrypto.map((s) =>
      subscribeTicker(s.symbol, (price, pct) => updateTicker(s.symbol, price, pct)),
    );
    return () => unsubs.forEach((u) => u());
  }, [data?.crypto, customSymbols, updateTicker]);

  // ── Add-symbol flow ───────────────────────────────────────────────────────
  const [isAdding,    setIsAdding]    = useState(false);
  const [addInput,    setAddInput]    = useState('');
  const [addError,    setAddError]    = useState<string | null>(null);
  const [addLoading,  setAddLoading]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) setTimeout(() => inputRef.current?.focus(), 0);
  }, [isAdding]);

  const openAdd = () => { setIsAdding(true); setAddInput(''); setAddError(null); };
  const closeAdd = () => { setIsAdding(false); setAddInput(''); setAddError(null); };

  const handleAddSubmit = useCallback(async () => {
    const raw = addInput.trim();
    if (!raw) return;

    setAddLoading(true);
    setAddError(null);

    try {
      const res  = await fetch(`/api/symbols/validate?symbol=${encodeURIComponent(raw)}`);
      const json = (await res.json()) as ValidateResponse;

      if (!json.valid) {
        setAddError(json.reason);
        return;
      }

      const { symbol: sym, marketSymbol } = json;

      // If the symbol is already on the default list but hidden, just un-hide it
      const isHidden = hiddenSymbols.includes(sym);
      if (isHidden) {
        showSymbol(sym);
        closeAdd();
        return;
      }

      // Check if already visible in any section
      const allVisible = [
        ...(data?.crypto   ?? []),
        ...(data?.equities ?? []),
        ...customSymbols,
      ];
      if (allVisible.some((s) => s.symbol === sym)) {
        setAddError(`${sym} is already in your watchlist`);
        return;
      }

      addCustomSymbol(marketSymbol);
      closeAdd();
    } catch {
      setAddError('Network error — try again');
    } finally {
      setAddLoading(false);
    }
  }, [addInput, hiddenSymbols, customSymbols, data, showSymbol, addCustomSymbol]);

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  handleAddSubmit();
    if (e.key === 'Escape') closeAdd();
  };

  // ── Remove handlers ───────────────────────────────────────────────────────
  const handleRemove = useCallback((sym: string, isCustom: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCustom) {
      removeCustomSymbol(sym);
    } else {
      hideSymbol(sym);
    }
    // Fall back to BTC if the active chart symbol was removed
    if (sym === symbol) setSymbol('BTCUSDT');
  }, [symbol, setSymbol, removeCustomSymbol, hideSymbol]);

  const handleToggleFav = useCallback((sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(sym);
  }, [toggleFavorite]);

  // ── Build rendered sections ───────────────────────────────────────────────
  const hiddenSet       = new Set(hiddenSymbols);
  const customSymbolSet = new Set(customSymbols.map((s) => s.symbol));
  const favSet          = new Set(favoriteSymbols);

  // Default crypto minus hidden and minus favorited (favorites shown in their own section)
  const cryptoItems = [
    ...(data?.crypto ?? []).filter((s) => !hiddenSet.has(s.symbol) && !favSet.has(s.symbol)),
    ...customSymbols.filter((s) => s.source === 'binance' && !favSet.has(s.symbol)),
  ];
  // MAG7 minus hidden and minus favorited
  const equityItems = (data?.equities ?? []).filter(
    (s) => !hiddenSet.has(s.symbol) && !favSet.has(s.symbol),
  );

  // Build a lookup map for resolving favorite symbols to MarketSymbol objects
  const allMap = new Map<string, MarketSymbol>();
  for (const s of [...(data?.crypto ?? []), ...customSymbols, ...(data?.equities ?? [])]) {
    allMap.set(s.symbol, s);
  }
  const favItems = favoriteSymbols
    .map((sym) => allMap.get(sym))
    .filter((s): s is MarketSymbol => s !== undefined);

  type Section = { id: string; label: string; items: MarketSymbol[]; isFavSection: boolean };
  const sections: Section[] = [
    ...(favItems.length > 0
      ? [{ id: 'favorites', label: '★ Favorites', items: favItems, isFavSection: true }]
      : []),
    { id: 'crypto',   label: 'Crypto',   items: cryptoItems,  isFavSection: false },
    { id: 'equities', label: 'Equities', items: equityItems,  isFavSection: false },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <aside className="flex flex-col h-full w-[220px] flex-shrink-0 bg-surface-1
                      border-r border-surface-border overflow-hidden">

      {/* ── Header ── */}
      <div className="px-3 py-3 border-b border-surface-border flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
            Watchlist
          </span>
          {data?.stale && (
            <span className="text-[10px] text-warn">stale</span>
          )}
        </div>
        <button
          onClick={openAdd}
          title="Add symbol"
          className="w-5 h-5 flex items-center justify-center rounded text-[15px] font-light
                     text-text-muted hover:bg-surface-3 hover:text-accent transition-colors
                     leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          +
        </button>
      </div>

      {/* ── Add-symbol input ── */}
      {isAdding && (
        <div className="px-2 py-2 border-b border-surface-border bg-surface-2 flex-shrink-0">
          <input
            ref={inputRef}
            value={addInput}
            onChange={(e) => { setAddInput(e.target.value); setAddError(null); }}
            onKeyDown={handleAddKeyDown}
            placeholder="e.g. PEPE or SOLUSDT"
            disabled={addLoading}
            className="w-full bg-surface-3 border border-surface-border rounded px-2 py-1
                       text-[11px] font-mono text-text-primary placeholder:text-text-muted
                       focus:outline-none focus:border-accent disabled:opacity-50"
          />
          {addError && (
            <p className="mt-1 text-[10px] text-red-400 leading-tight">{addError}</p>
          )}
          <div className="flex gap-1 mt-1.5">
            <button
              onClick={handleAddSubmit}
              disabled={addLoading || !addInput.trim()}
              className="flex-1 text-[10px] py-0.5 rounded bg-accent/20 text-accent
                         hover:bg-accent/30 disabled:opacity-40 transition-colors"
            >
              {addLoading ? 'Checking…' : 'Add'}
            </button>
            <button
              onClick={closeAdd}
              className="flex-1 text-[10px] py-0.5 rounded bg-surface-3 text-text-muted
                         hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Symbol list ── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading && (
          <div className="px-3 py-4 text-xs text-text-muted animate-pulse">Loading…</div>
        )}

        {sections.map(({ id, label, items, isFavSection }) =>
          items.length === 0 ? null : (
            <div key={id}>
              {/* Section header */}
              <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider
                              sticky top-0 bg-surface-1 z-10">
                {label}
              </div>

              {items.map((item) => (
                <SymbolRow
                  key={`${id}-${item.symbol}`}
                  item={item}
                  isActive={item.symbol === symbol}
                  isCustom={customSymbolSet.has(item.symbol)}
                  isFavorited={favSet.has(item.symbol)}
                  ticker={tickers[item.symbol]}
                  isFavSection={isFavSection}
                  onSelect={() => setSymbol(item.symbol)}
                  onToggleFav={(e) => handleToggleFav(item.symbol, e)}
                  onRemove={(e) => handleRemove(item.symbol, customSymbolSet.has(item.symbol), e)}
                />
              ))}
            </div>
          ),
        )}
      </div>
    </aside>
  );
}
