import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Strategy } from '@/types/strategy';
import type { Timeframe, Candle } from '@/types/market';
import { collectHtfTimeframes, type HtfCandleSets } from '@/lib/strategy/mtf';

interface RawCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

async function fetchCandles(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const url = `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${tf} candles for ${symbol}`);
  }
  const { data: raw } = await res.json() as { data: RawCandle[] };
  return raw.map((r) => ({
    openTime: Number(r.openTime),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    closeTime: Number(r.closeTime),
    isClosed: true, // Data from Postgres is historically closed
  }));
}

export function useHtfCandles(strategies: Strategy[]) {
  // Find all distinct (symbol, htf) pairs across all strategies
  const requiredPairs = useMemo(() => {
    const pairs = new Map<string, { symbol: string; tf: Timeframe }>();
    for (const s of strategies) {
      if (s.isActive || s.isMtf) {
        const htfTfs = collectHtfTimeframes(s);
        for (const tf of htfTfs) {
          const key = `${s.symbol}|${tf}`;
          if (!pairs.has(key)) {
            pairs.set(key, { symbol: s.symbol, tf });
          }
        }
      }
    }
    return Array.from(pairs.values());
  }, [strategies]);

  const queryResults = useQueries({
    queries: requiredPairs.map((pair) => ({
      queryKey: ['candles', pair.symbol, pair.tf, 1000],
      queryFn: () => fetchCandles(pair.symbol, pair.tf),
      staleTime: 60 * 1000,
      refetchInterval: 60 * 1000,
    })),
  });

  const isLoading = queryResults.some((q) => q.isLoading);

  // Group fetched candles by symbol -> htfCandles
  const htfCandlesBySymbol = useMemo(() => {
    const map = new Map<string, HtfCandleSets>();
    
    requiredPairs.forEach((pair, i) => {
      const data = queryResults[i]?.data;
      if (data) {
        if (!map.has(pair.symbol)) {
          map.set(pair.symbol, {});
        }
        map.get(pair.symbol)![pair.tf] = data;
      }
    });

    return map;
  }, [requiredPairs, queryResults]);

  return { htfCandlesBySymbol, isLoading };
}
