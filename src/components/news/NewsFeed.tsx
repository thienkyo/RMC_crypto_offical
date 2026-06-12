'use client';

/**
 * NewsFeed — right-rail news panel for the active symbol.
 *
 * Layout:
 *  ┌─────────────────────────┐
 *  │ Header: "News" + source │
 *  │ SentimentHeatBar (24h)  │
 *  │ HourlyDigest (on-demand)│
 *  │ Scrollable article list │
 *  │   NewsItem × N          │
 *  └─────────────────────────┘
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useChartStore } from '@/store/chart';
import { useNewsFeed } from '@/hooks/useNewsFeed';
import { SentimentHeatBar } from './SentimentHeatBar';
import { HourlyDigest } from './HourlyDigest';
import { NewsItem } from './NewsItem';

const SOURCE_FILTERS = [
  { label: 'All',    value: undefined },
  { label: 'News',   value: 'coindesk' },
  { label: 'Reddit', value: 'reddit' },
  { label: 'X',      value: 'nitter' },
] as const;

interface RefreshResult {
  totalInserted: number;
  classified:    number;
}

export function NewsFeed() {
  const symbol = useChartStore((s) => s.symbol);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined);

  const { data, isLoading, error, dataUpdatedAt } = useNewsFeed(symbol, sourceFilter);

  // Manual pipeline trigger. On success we invalidate the news queries so
  // TanStack Query refetches the feed/digest and the panel repaints with the
  // newly-crawled, freshly-classified articles.
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: async (): Promise<RefreshResult> => {
      const res = await fetch('/api/news/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh failed (HTTP ${res.status})`);
      return res.json() as Promise<RefreshResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['news-feed'] });
      queryClient.invalidateQueries({ queryKey: ['news-digest'] });
      queryClient.invalidateQueries({ queryKey: ['polymarket'] });
    },
  });

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-surface-border flex-shrink-0">
        <span className="text-[11px] font-mono uppercase tracking-widest text-text-muted">
          News · {symbol}
        </span>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] font-mono text-text-muted">{lastUpdated}</span>
          )}
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            title="Crawl all sources and classify sentiment now"
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors
              ${refresh.isPending
                ? 'text-text-muted border-surface-border cursor-wait'
                : 'text-accent border-accent/30 hover:bg-accent/15'
              }`}
          >
            {refresh.isPending ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Refresh result / error line */}
      {(refresh.isSuccess || refresh.isError) && (
        <div
          className={`px-3 py-1 text-[10px] font-mono border-b border-surface-border flex-shrink-0
            ${refresh.isError ? 'text-down' : 'text-text-muted'}`}
        >
          {refresh.isError
            ? (refresh.error as Error).message
            : `+${refresh.data.totalInserted} new · ${refresh.data.classified} classified`}
        </div>
      )}

      {/* Sentiment heat bar */}
      <div className="flex-shrink-0 border-b border-surface-border">
        <SentimentHeatBar aggregate={data?.aggregate ?? null} />
      </div>

      {/* Source filter tabs */}
      <div className="flex gap-1 px-3 py-1.5 border-b border-surface-border flex-shrink-0">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setSourceFilter(f.value)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors
              ${sourceFilter === f.value
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-text-muted hover:text-text-primary border border-transparent'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Hourly digest (collapsed by default) */}
      <div className="flex-shrink-0 pt-2">
        <HourlyDigest symbol={symbol} />
      </div>

      {/* Article list */}
      <div className="flex-1 overflow-y-auto px-3">
        {isLoading && (
          <div className="flex items-center justify-center py-6 text-[11px] text-text-muted animate-pulse">
            Loading news…
          </div>
        )}

        {error && (
          <div className="py-4 text-[11px] text-down text-center">
            Failed to load news feed.
          </div>
        )}

        {data && data.articles.length === 0 && !isLoading && (
          <div className="py-6 text-[11px] text-text-muted text-center leading-relaxed">
            No articles found for {symbol}.<br />
            Crawlers run every 15–30 min — check back soon.
          </div>
        )}

        {data?.articles.map((article) => (
          <NewsItem key={article.id} article={article} />
        ))}
      </div>
    </div>
  );
}
