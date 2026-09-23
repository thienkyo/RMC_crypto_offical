import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MarketSymbol } from '@/types/market';

export interface SymbolsResponse {
  crypto:   MarketSymbol[];
  mag7?:    MarketSymbol[];
  ai?:      MarketSymbol[];
  equities: MarketSymbol[];
  /** Set by the route when it served a cached universe after a sync failure. */
  stale?:   boolean;
}

/**
 * The tradeable symbol universe — Binance top-20 (rebuilt hourly from rank) plus
 * any equities. Shared by the watchlist and the command palette.
 *
 * Both callers must agree on the cache config: TanStack evaluates staleness per
 * observer, so a shorter staleTime on one of them marks the shared entry stale
 * for everyone and refetches behind `/api/symbols`'s own 1-hour revalidate.
 * Keeping the single declaration here is what makes that hold.
 *
 * `enabled` lets a caller that is mounted but not visible (the always-mounted
 * command palette) hold off the request until it is actually opened.
 */
export function useSymbols(enabled = true): UseQueryResult<SymbolsResponse> {
  return useQuery<SymbolsResponse>({
    queryKey: ['symbols'],
    queryFn: async () => {
      const res = await fetch('/api/symbols');
      // Without this the route's JSON error body resolves as a successful
      // response, `crypto`/`equities` come back undefined, and every caller
      // renders an empty list that is indistinguishable from "no symbols".
      if (!res.ok) {
        throw new Error(`Failed to load symbols (${res.status} ${res.statusText})`);
      }
      return res.json();
    },
    staleTime:       3_600_000,
    refetchInterval: 3_600_000,
    enabled,
  });
}
