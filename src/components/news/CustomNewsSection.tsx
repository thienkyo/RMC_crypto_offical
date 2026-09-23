'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCustomNews } from '@/hooks/useCustomNews';
import { NewsItem } from './NewsItem';

export function CustomNewsSection() {
  const [collapsed, setCollapsed] = useState(false);
  const { data: articles, isLoading, isError } = useCustomNews();

  const count = articles?.length ?? 0;

  return (
    <div className="border-b border-surface-border">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-mono uppercase tracking-wider
                   text-text-muted hover:text-text-secondary bg-surface-2/40 hover:bg-surface-2/70 transition-colors select-none"
      >
        <div className="flex items-center gap-1.5">
          <svg
            viewBox="0 0 16 16"
            className={`w-2.5 h-2.5 transition-transform duration-150 ${collapsed ? '-rotate-90' : 'rotate-0'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M3 6l5 5 5-5" />
          </svg>
          <span className="font-semibold text-accent/90">Custom Feeds</span>
        </div>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <span className="text-[10px] font-mono text-text-muted/70 normal-case">
              {count} {count === 1 ? 'article' : 'articles'}
            </span>
          )}
        </div>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-3 bg-surface-1/40">
          {isLoading ? (
            <div className="text-[11px] font-mono text-text-muted animate-pulse py-2">
              Loading custom feeds…
            </div>
          ) : isError ? (
            <div className="text-[11px] font-mono text-down py-1">
              Could not load custom feeds
            </div>
          ) : count === 0 ? (
            <div className="text-[11px] font-mono text-text-muted py-2 space-y-1">
              <p>No articles from custom sources yet.</p>
              <Link
                href="/settings"
                className="text-[10px] text-accent hover:underline inline-block mt-0.5"
              >
                Manage custom feeds in Settings →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-surface-border">
              {articles?.slice(0, 10).map((article) => (
                <div key={article.id} className="py-1">
                  <NewsItem article={article} />
                  {article.symbols && article.symbols.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      {article.symbols.slice(0, 4).map((sym) => (
                        <span
                          key={sym}
                          className="px-1 py-0.2 rounded text-[9px] font-mono bg-surface-3 text-accent/80 border border-surface-border"
                        >
                          ${sym.replace('USDT', '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
