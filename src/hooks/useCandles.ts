import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChartStore } from '@/store/chart';
import type { Candle } from '@/types/market';

interface CandlesResponse {
  symbol:   string;
  interval: string;
  data:     Candle[];
}

/**
 * Fetches OHLCV candles for the currently selected symbol + timeframe.
 * Results are cached by TanStack Query and revalidated every 60s.
 * Also writes candles into the Zustand store so the chart can read them.
 *
 * Intentionally no `keepPreviousData` / `placeholderData` on symbol switches:
 * the store clears candles on setSymbol/setTimeframe, and writing a previous
 * series into the chart poisons PriceChart's context guard. Timeframe-only
 * keep is also skipped — the chart source of truth is the store, which is
 * emptied on TF change as well (brief empty flash is accepted).
 */
export function useCandles() {
  const symbol    = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setCandles = useChartStore((s) => s.setCandles);
  const setLoading = useChartStore((s) => s.setLoading);

  const query = useQuery<Candle[]>({
    queryKey: ['candles', symbol, timeframe],

    queryFn: async () => {
      const requestedSymbol = symbol;
      const requestedTf     = timeframe;
      const contextKey      = `${requestedSymbol}-${requestedTf}`;

      setLoading(true);
      try {
        // No limit param → server uses SERVE_LIMIT[tf] (timeframe-appropriate depth)
        const res = await fetch(
          `/api/candles?symbol=${requestedSymbol}&interval=${requestedTf}`,
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as CandlesResponse;
        // Drop the write if the user switched ticker/TF while this request was
        // in flight — otherwise BTC history can land on a PAXG chart.
        setCandles(json.data, contextKey);
        return json.data;
      } finally {
        setLoading(false);
      }
    },

    staleTime:       60_000,
    refetchInterval: 60_000,
    retry:           2,
  });

  // Cache hits skip queryFn, so sync cached data into the store after a
  // switch (store was cleared). Skip when this context is already loaded —
  // otherwise a 60s refetch would replay REST history over a live last bar.
  useEffect(() => {
    if (!query.data) return;
    const key = `${symbol}-${timeframe}`;
    const state = useChartStore.getState();
    if (state.candlesKey === key && state.candles.length > 0) return;
    setCandles(query.data, key);
  }, [query.data, symbol, timeframe, setCandles]);

  return query;
}
