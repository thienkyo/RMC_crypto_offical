import { useQuery, keepPreviousData } from '@tanstack/react-query';
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
 */
export function useCandles() {
  const symbol    = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setCandles = useChartStore((s) => s.setCandles);
  const setLoading = useChartStore((s) => s.setLoading);

  return useQuery<Candle[]>({
    queryKey: ['candles', symbol, timeframe],

    queryFn: async () => {
      setLoading(true);
      try {
        // No limit param → server uses SERVE_LIMIT[tf] (timeframe-appropriate depth)
        const res = await fetch(
          `/api/candles?symbol=${symbol}&interval=${timeframe}`,
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as CandlesResponse;
        setCandles(json.data);
        return json.data;
      } finally {
        setLoading(false);
      }
    },

    staleTime:        60_000,
    refetchInterval:  60_000,
    retry:            2,
    // Keep showing previous symbol's candles while the next one loads —
    // avoids the blank-chart flash on every symbol/timeframe switch.
    placeholderData:  keepPreviousData,
  });
}
