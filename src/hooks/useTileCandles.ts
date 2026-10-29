import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subscribeKline } from '@/lib/exchange/binance';
import type { Candle, Timeframe } from '@/types/market';

interface UseTileCandlesOptions {
  symbol: string;
  timeframe: Timeframe;
}

interface UseTileCandlesResult {
  candles: Candle[];
  livePrice: number | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

interface CandlesApiResponse {
  symbol: string;
  interval: string;
  data: Candle[];
}

export function useTileCandles({ symbol, timeframe }: UseTileCandlesOptions): UseTileCandlesResult {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // TanStack Query for caching and deduplicating REST historical candles across tiles
  const query = useQuery<Candle[]>({
    queryKey: ['tile-candles', symbol, timeframe],
    queryFn: async () => {
      const res = await fetch(`/api/candles?symbol=${symbol}&interval=${timeframe}&source=binance`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CandlesApiResponse;
      return json.data ?? [];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 2,
  });

  // Sync historical query data to local state on fetch or symbol/timeframe switch
  useEffect(() => {
    if (query.data) {
      setCandles(query.data);
      if (query.data.length > 0) {
        setLivePrice(query.data[query.data.length - 1]!.close);
      }
    }
  }, [query.data, symbol, timeframe]);

  // Subscribe to live WebSocket tick updates for this tile
  useEffect(() => {
    let active = true;

    const unsubscribe = subscribeKline(symbol, timeframe, (candle: Candle) => {
      if (!active) return;
      setLivePrice(candle.close);

      setCandles((prev) => {
        if (prev.length === 0) return [candle];
        const last = prev[prev.length - 1]!;
        if (candle.openTime === last.openTime) {
          const next = [...prev];
          next[next.length - 1] = candle;
          return next;
        } else if (candle.openTime > last.openTime) {
          return [...prev, candle];
        }
        return prev;
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [symbol, timeframe]);

  return {
    candles,
    livePrice,
    isLoading: query.isLoading && candles.length === 0,
    isError: query.isError,
    error: query.error as Error | null,
  };
}
