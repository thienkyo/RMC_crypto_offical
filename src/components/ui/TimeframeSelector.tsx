'use client';

import { useChartStore } from '@/store/chart';
import { TIMEFRAMES } from '@/types/market';
import { clsx } from 'clsx';

/** Horizontal row of timeframe buttons. Keyboard shortcut: 1–9 for first 9 TFs. */
export function TimeframeSelector() {
  const timeframe    = useChartStore((s) => s.timeframe);
  const setTimeframe = useChartStore((s) => s.setTimeframe);

  return (
    <div className="flex items-center gap-0.5 rounded bg-surface-2 p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          onClick={() => setTimeframe(tf)}
          className={clsx(
            'px-2 py-1 rounded text-[11px] font-mono transition-colors',
            tf === timeframe
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-3',
          )}
          title={`Switch to ${tf} (${tf})`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
