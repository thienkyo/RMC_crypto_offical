'use client';

import { useState, useRef, useEffect } from 'react';
import { useChartStore } from '@/store/chart';
import { TIMEFRAMES } from '@/types/market';
import { clsx } from 'clsx';

/** Compact timeframe selector dropdown. */
export function TimeframeSelector() {
  const timeframe    = useChartStore((s) => s.timeframe);
  const setTimeframe = useChartStore((s) => s.setTimeframe);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-2
                   text-text-primary hover:text-white text-[11px] font-mono font-bold
                   border border-surface-border transition-colors min-w-[50px] justify-between"
        title={`Switch timeframe (currently ${timeframe})`}
      >
        <span>{timeframe}</span>
        <span className="text-[8px] opacity-60">▼</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-surface-2 border
                        border-surface-border rounded-lg shadow-xl z-50 p-1
                        grid grid-cols-3 gap-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => {
                setTimeframe(tf);
                setOpen(false);
              }}
              className={clsx(
                'px-2 py-1.5 rounded text-[11px] font-mono transition-colors text-center',
                tf === timeframe
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-3',
              )}
              title={tf}
            >
              {tf}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
