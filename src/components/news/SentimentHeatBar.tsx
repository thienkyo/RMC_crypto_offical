'use client';

/**
 * SentimentHeatBar — 24-hour aggregate sentiment for the active symbol.
 *
 * Renders a horizontal bar that fills from the center:
 *   left = bearish (red), right = bullish (green), center = neutral.
 */

import type { NewsFeedAggregate } from '@/types/news';

interface Props {
  aggregate: NewsFeedAggregate | null;
}

export function SentimentHeatBar({ aggregate }: Props) {
  if (!aggregate) {
    return (
      <div className="px-3 py-2">
        <div className="flex justify-between text-[10px] font-mono text-text-muted mb-1">
          <span>24h Sentiment</span>
          <span>no data</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2" />
      </div>
    );
  }

  // score: -1 (full bearish) to +1 (full bullish)
  // Map to 0-100% for the fill position
  const pct = Math.round((aggregate.score + 1) / 2 * 100);

  // Fill from 50% (center) toward right (bullish) or left (bearish)
  const isBull    = aggregate.score >= 0;
  const fillLeft  = isBull ? 50 : pct;
  const fillWidth = Math.abs(pct - 50);
  const fillColor = isBull ? 'bg-up' : 'bg-down';

  const sign = aggregate.score > 0 ? '+' : '';
  const label = `${sign}${aggregate.score.toFixed(2)} · ${aggregate.label} · ${aggregate.articleCount} articles`;

  return (
    <div className="px-3 py-2">
      <div className="flex justify-between text-[10px] font-mono text-text-muted mb-1">
        <span>24h Sentiment</span>
        <span className={
          aggregate.label === 'bullish' ? 'text-up' :
          aggregate.label === 'bearish' ? 'text-down' :
          'text-text-secondary'
        }>
          {label}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
        {/* Center marker */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-surface-border" />
        {/* Colored fill */}
        <div
          className={`absolute inset-y-0 ${fillColor} opacity-80`}
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}
