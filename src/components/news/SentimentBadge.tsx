'use client';

/**
 * SentimentBadge — compact score + label pill.
 * Finance-terminal style: color-coded, monospace numbers.
 */

import type { SentimentLabel } from '@/types/news';

interface Props {
  score:  number;       // -1.0 to +1.0
  label:  SentimentLabel;
  size?:  'sm' | 'md';
}

const LABEL_STYLES: Record<SentimentLabel, string> = {
  bullish: 'text-up   bg-up/10   border-up/30',
  bearish: 'text-down bg-down/10 border-down/30',
  neutral: 'text-text-secondary bg-surface-2 border-surface-border',
};

export function SentimentBadge({ score, label, size = 'sm' }: Props) {
  const sign    = score > 0 ? '+' : '';
  const display = `${sign}${score.toFixed(2)}`;
  const textSz  = size === 'sm' ? 'text-[10px]' : 'text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono font-semibold
        ${textSz} ${LABEL_STYLES[label]}`}
      title={`Sentiment: ${label} (${display})`}
    >
      <span className="opacity-70 capitalize">{label}</span>
      <span>{display}</span>
    </span>
  );
}
