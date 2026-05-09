'use client';

/**
 * useAlertPoller — runs the alert evaluation loop on a 60-second tick.
 *
 * Why: Vercel crons only fire on deployed infrastructure. In local dev (or
 * if the cron is missed), this hook keeps signals firing while the browser
 * tab is open — no manual button clicks needed.
 *
 * Behaviour:
 *   • Fires immediately on mount (catches the case where a candle already closed
 *     before the page was opened).
 *   • Polls every INTERVAL_MS thereafter.
 *   • Pauses when the tab is hidden; resumes (and fires immediately) when
 *     visible again — prevents accumulating skipped ticks.
 *   • Never throws to the caller — errors are logged and silently skipped.
 */

import { useEffect, useRef } from 'react';

const INTERVAL_MS = 60_000; // 1 minute — matches cron schedule

async function runCheck(): Promise<void> {
  try {
    const res = await fetch('/api/cron/check-alerts', { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[alert-poller] check-alerts returned ${res.status}`);
      return;
    }
    const data = await res.json() as {
      ok: boolean;
      fired?: number;
      strategies?: Array<{ name: string; result: string }>;
    };
    if ((data.fired ?? 0) > 0) {
      console.log(`[alert-poller] ${data.fired} alert(s) fired`);
    }
  } catch (err) {
    console.warn('[alert-poller] fetch failed:', err);
  }
}

export function useAlertPoller(): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Fire immediately on mount
    void runCheck();

    // Then poll every INTERVAL_MS
    intervalRef.current = setInterval(() => { void runCheck(); }, INTERVAL_MS);

    // Pause/resume on visibility change to avoid missed ticks
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Tab became active again — fire immediately to catch up
        void runCheck();
        if (!intervalRef.current) {
          intervalRef.current = setInterval(() => { void runCheck(); }, INTERVAL_MS);
        }
      } else {
        // Tab hidden — stop the interval (it would fire into the void anyway)
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
