'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery }   from '@tanstack/react-query';
import { useChartStore } from '@/store/chart';
import { subscribeTicker } from '@/lib/exchange/binance';
import { clsx } from 'clsx';
import type { MarketSymbol } from '@/types/market';

interface SymbolsResponse {
  crypto:   MarketSymbol[];
  equities: MarketSymbol[];
  stale?:   boolean;
}

interface TickerState {
  price:      number;
  changePct:  number;
  flashing:   boolean; // brief flash on price update
}

/** Left-rail watchlist with live price ticks for crypto symbols. */
export function Watchlist() {
  const symbol    = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);

  const { data, isLoading } = useQuery<SymbolsResponse>({
    queryKey:         ['symbols'],
    queryFn:          () => fetch('/api/symbols').then((r) => r.json()),
    staleTime:        3_600_000, // top-20 is stable for an hour
    refetchInterval:  3_600_000,
  });

  // ── Live price ticks ────────────────────────────────────────────────────
  const [tickers, setTickers] = useState<Record<string, TickerState>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const updateTicker = (sym: string, price: number, changePct: number) => {
    setTickers((prev) => ({
      ...prev,
      [sym]: { price, changePct, flashing: true },
    }));
    // Clear flash after 400ms
    clearTimeout(flashTimers.current[sym]);
    flashTimers.current[sym] = setTimeout(() => {
      setTickers((prev) => ({
        ...prev,
        [sym]: prev[sym] ? { ...prev[sym]!, flashing: false } : { price, changePct, flashing: false },
      }));
    }, 400);
  };

  // Subscribe to tickers for all crypto symbols in the watchlist
  useEffect(() => {
    if (!data?.crypto) return;
    const unsubs: (() => void)[] = [];
    for (const s of data.crypto) {
      const unsub = subscribeTicker(s.symbol, (price, changePct) => {
        updateTicker(s.symbol, price, changePct);
      });
      unsubs.push(unsub);
    }
    return () => unsubs.forEach((u) => u());
  }, [data?.crypto]);

  const allSymbols: Array<{ section: string; items: MarketSymbol[] }> = [
    { section: 'Crypto',   items: data?.crypto   ?? [] },
    { section: 'Equities', items: data?.equities ?? [] },
  ];

  return (
    <aside className="flex flex-col w-[220px] flex-shrink-0 bg-surface-1
                      border-r border-surface-border overflow-hidden">
      {/* Header */}
      <div className="px-3 py-3 border-b border-surface-border">
        <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
          Watchlist
        </span>
        {data?.stale && (
          <span className="ml-2 text-[10px] text-warn">stale</span>
        )}
      </div>

      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isLoading && (
          <div className="px-3 py-4 text-xs text-text-muted animate-pulse">Loading…</div>
        )}

        {allSymbols.map(({ section, items }) =>
          items.length === 0 ? null : (
            <div key={section}>
              <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider
                              sticky top-0 bg-surface-1 z-10">
                {section}
              </div>

              {items.map((item) => {
                const ticker    = tickers[item.symbol];
                const isActive  = item.symbol === symbol;
                const changePct = ticker?.changePct ?? 0;

                return (
                  <button
                    key={item.symbol}
                    onClick={() => setSymbol(item.symbol)}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2',
                      'transition-colors text-left group',
                      isActive
                        ? 'bg-accent/10 border-l-2 border-accent'
                        : 'hover:bg-surface-3 border-l-2 border-transparent',
                    )}
                  >
                    <div className="flex flex-col min-w-0">
                      <span
                        className={clsx(
                          'text-[12px] font-mono font-semibold truncate',
                          isActive ? 'text-accent' : 'text-text-primary',
                        )}
                      >
                        {item.baseAsset}
                      </span>
                      <span className="text-[10px] text-text-muted truncate">
                        {item.displayName}
                      </span>
                    </div>

                    <div className="flex flex-col items-end flex-shrink-0 ml-2">
                      {ticker ? (
                        <>
                          <span
                            className={clsx(
                              'text-[11px] font-mono text-text-price transition-colors',
                              ticker.flashing && (ticker.changePct >= 0 ? 'text-up' : 'text-down'),
                            )}
                          >
                            {ticker.price.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: ticker.price < 1 ? 6 : 2,
                            })}
                          </span>
                          <span
                            className={clsx(
                              'text-[10px] font-mono',
                              changePct >= 0 ? 'text-up' : 'text-down',
                            )}
                          >
                            {changePct >= 0 ? '+' : ''}
                            {changePct.toFixed(2)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-text-muted">—</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ),
        )}
      </div>
    </aside>
  );
}
