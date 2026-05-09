'use client';

import { useChartStore } from '@/store/chart';

/**
 * Thin amber banner shown when the live feed has gone silent.
 * Sits between the top bar and the chart without obscuring price data.
 */
export function StaleDataBanner() {
  const setStale = useChartStore((s) => s.setStale);

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5
                    bg-warn/10 border-b border-warn/30 text-warn text-xs font-mono
                    flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
        <span>Live feed stale — data may be delayed.</span>
      </div>
      <button
        onClick={() => setStale(false)}
        className="opacity-60 hover:opacity-100 transition-opacity text-[10px]"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
