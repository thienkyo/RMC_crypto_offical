import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MarketSymbol } from '@/types/market';

interface WatchlistState {
  // ── Persisted user preferences ────────────────────────────────────────────
  /** Default-list symbols the user dismissed (hidden from view). */
  hiddenSymbols:   string[];
  /** User-added symbols, validated against Binance before storing. */
  customSymbols:   MarketSymbol[];
  /** Ordered list of starred symbol strings (any section). */
  favoriteSymbols: string[];

  // ── Actions ───────────────────────────────────────────────────────────────
  /** Move a default symbol to the hidden list (also removes from favorites). */
  hideSymbol:         (symbol: string) => void;
  /** Un-hide a previously hidden default symbol. */
  showSymbol:         (symbol: string) => void;
  /** Append a user-added symbol (no-op if already present). */
  addCustomSymbol:    (symbol: MarketSymbol) => void;
  /** Remove a user-added symbol (also removes from favorites). */
  removeCustomSymbol: (symbol: string) => void;
  /** Toggle a symbol in/out of the favorites list. */
  toggleFavorite:     (symbol: string) => void;
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set) => ({
      hiddenSymbols:   [],
      customSymbols:   [],
      favoriteSymbols: [],

      hideSymbol: (symbol) =>
        set((s) => ({
          hiddenSymbols:   s.hiddenSymbols.includes(symbol)
            ? s.hiddenSymbols
            : [...s.hiddenSymbols, symbol],
          favoriteSymbols: s.favoriteSymbols.filter((x) => x !== symbol),
        })),

      showSymbol: (symbol) =>
        set((s) => ({
          hiddenSymbols: s.hiddenSymbols.filter((x) => x !== symbol),
        })),

      addCustomSymbol: (symbol) =>
        set((s) => ({
          customSymbols: s.customSymbols.some((c) => c.symbol === symbol.symbol)
            ? s.customSymbols
            : [...s.customSymbols, symbol],
        })),

      removeCustomSymbol: (symbol) =>
        set((s) => ({
          customSymbols:   s.customSymbols.filter((c) => c.symbol !== symbol),
          favoriteSymbols: s.favoriteSymbols.filter((x) => x !== symbol),
        })),

      toggleFavorite: (symbol) =>
        set((s) => ({
          favoriteSymbols: s.favoriteSymbols.includes(symbol)
            ? s.favoriteSymbols.filter((x) => x !== symbol)
            : [...s.favoriteSymbols, symbol],
        })),
    }),
    {
      name: 'rmc-watchlist',
      partialize: (s) => ({
        hiddenSymbols:   s.hiddenSymbols,
        customSymbols:   s.customSymbols,
        favoriteSymbols: s.favoriteSymbols,
      }),
    },
  ),
);
