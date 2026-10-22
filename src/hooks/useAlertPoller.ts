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

export const ALERT_POLL_INTERVAL_STORAGE_KEY = 'rmc_alert_poll_interval_ms';
export const ALERT_POLL_INTERVAL_EVENT = 'rmc-poll-interval-changed';
export const DEFAULT_ALERT_POLL_INTERVAL_MS = 5 * 60_000; // Default 5 minutes

export function getStoredAlertPollIntervalMs(): number {
  if (typeof window === 'undefined') return DEFAULT_ALERT_POLL_INTERVAL_MS;
  try {
    const raw = localStorage.getItem(ALERT_POLL_INTERVAL_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (parsed === 5 * 60_000 || parsed === 10 * 60_000 || parsed === 15 * 60_000) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_ALERT_POLL_INTERVAL_MS;
}

export function setStoredAlertPollIntervalMs(ms: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ALERT_POLL_INTERVAL_STORAGE_KEY, String(ms));
    window.dispatchEvent(new CustomEvent(ALERT_POLL_INTERVAL_EVENT, { detail: ms }));
  } catch {
    // ignore storage errors
  }
}

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
    function startTimer(ms: number) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        void runCheck();
      }, ms);
    }

    // Fire immediately on mount
    void runCheck();
    startTimer(getStoredAlertPollIntervalMs());

    function handleIntervalChange(e: Event) {
      const custom = e as CustomEvent<number>;
      const nextMs = typeof custom.detail === 'number' ? custom.detail : getStoredAlertPollIntervalMs();
      startTimer(nextMs);
    }

    window.addEventListener(ALERT_POLL_INTERVAL_EVENT, handleIntervalChange);

    return () => {
      window.removeEventListener(ALERT_POLL_INTERVAL_EVENT, handleIntervalChange);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
