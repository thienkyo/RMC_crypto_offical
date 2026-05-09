/**
 * TanStack Query hooks for the news feed API.
 * Polls every 60s — news doesn't need real-time refresh.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { NewsFeedResponse, NewsDigestResponse, PolymarketSnapshot } from '@/types/news';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function useNewsFeed(symbol: string, source?: string) {
  const params = new URLSearchParams({ symbol, window: '24h', limit: '50' });
  if (source) params.set('source', source);

  return useQuery<NewsFeedResponse>({
    queryKey:  ['news-feed', symbol, source],
    queryFn:   () => fetchJson<NewsFeedResponse>(`/api/news/feed?${params}`),
    staleTime: 60_000,        // treat as fresh for 60s
    refetchInterval: 60_000,  // background refresh every 60s
    enabled:   !!symbol,
  });
}

export function useNewsDigest(symbol: string, enabled: boolean) {
  return useQuery<NewsDigestResponse>({
    queryKey:  ['news-digest', symbol],
    queryFn:   () => fetchJson<NewsDigestResponse>(`/api/news/digest?symbol=${symbol}`),
    staleTime: 30 * 60_000, // digest cached 30 min server-side
    enabled:   !!symbol && enabled,
    retry:     1,
  });
}

export function usePolymarket(symbol: string) {
  return useQuery<{ markets: PolymarketSnapshot[] }>({
    queryKey:  ['polymarket', symbol],
    queryFn:   () => fetchJson<{ markets: PolymarketSnapshot[] }>(`/api/news/polymarket?symbol=${symbol}`),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled:   !!symbol,
  });
}
