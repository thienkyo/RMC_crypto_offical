'use client';

import { useState, useRef, useEffect } from 'react';
import { useChartStore } from '@/store/chart';
import { TIMEFRAMES, type Timeframe } from '@/types/market';
import { clsx } from 'clsx';

const FAVORITE_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

/**
 * Fast-access timeframe selector with 1-click favorite pills
 * and a dropdown for secondary timeframes (3m, 30m, 2h, 6h, 12h, 1w).
 */
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

  const isCustomActive = !FAVORITE_TIMEFRAMES.includes(timeframe);

  return (
    <div ref={ref} className="relative flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs">
      {FAVORITE_TIMEFRAMES.map((tf) => {
        const active = timeframe === tf;
        return (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={clsx(
              'px-2 py-0.5 rounded text-[11px] font-mono transition-colors font-medium',
              active
                ? 'bg-accent text-white font-bold shadow-sm'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-2',
            )}
            title={`Switch to ${tf}`}
          >
            {tf}
          </button>
        );
      })}

      {/* Dropdown chevron for remaining timeframes */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors',
          isCustomActive
            ? 'bg-accent text-white font-bold shadow-sm'
            : 'text-text-muted hover:text-text-primary hover:bg-surface-2',
        )}
        title="More timeframes"
      >
        {isCustomActive && <span>{timeframe}</span>}
        <span className="text-[8px] opacity-75">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-surface-2 border border-surface-border rounded-lg shadow-xl z-50 p-1.5 grid grid-cols-3 gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => {
                setTimeframe(tf);
                setOpen(false);
              }}
              className={clsx(
                'px-2 py-1 rounded text-[11px] font-mono transition-colors text-center',
                tf === timeframe
                  ? 'bg-accent text-white font-bold'
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
