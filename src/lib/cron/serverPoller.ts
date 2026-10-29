/**
 * ServerAlertPoller — 24/7 background alert loop running inside the Node.js server.
 *
 * Runs check-alerts periodically (default: every 5 minutes) so Telegram alerts
 * fire even when all browser tabs are closed.
 */

import { runCheckAlerts } from '@/app/api/cron/check-alerts/route';

declare global {
  // eslint-disable-next-line no-var
  var _rmcServerPollerTimer: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var _rmcSignalMonitorTimer: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var _rmcServerPollerRunning: boolean | undefined;
}

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

export function getServerPollIntervalMs(): number {
  const envVal = process.env['ALERT_POLL_INTERVAL_MS'];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 60_000) return parsed;
  }
  return DEFAULT_POLL_INTERVAL_MS;
}

async function runTick(): Promise<void> {
  if (globalThis._rmcServerPollerRunning) return;
  globalThis._rmcServerPollerRunning = true;
  try {
    const res = await runCheckAlerts();
    if (!res.ok) {
      console.warn(`[server-poller] runCheckAlerts returned ${res.status}`);
      return;
    }
    const data = (await res.json()) as { fired?: number };
    if ((data.fired ?? 0) > 0) {
      console.log(`[server-poller] ${data.fired} alert(s) fired`);
    }
  } catch (err) {
    console.error('[server-poller] unexpected error during check-alerts:', err);
  } finally {
    globalThis._rmcServerPollerRunning = false;
  }
}

export function startServerAlertPoller(): void {
  // Don't start multiple intervals during hot reload
  if (globalThis._rmcServerPollerTimer) {
    return;
  }

  const intervalMs = getServerPollIntervalMs();
  console.log(`[server-poller] Starting 24/7 server alert poller (interval: ${intervalMs / 1000}s)`);

  // Run initial tick after a brief 10s delay to allow DB pool and routes to initialize
  setTimeout(() => {
    void runTick();
  }, 10_000);

  globalThis._rmcServerPollerTimer = setInterval(() => {
    void runTick();
  }, intervalMs);

  // Dedicated lightweight 30s price monitor for active trades (TP/SL/BE)
  if (!globalThis._rmcSignalMonitorTimer) {
    globalThis._rmcSignalMonitorTimer = setInterval(() => {
      import('@/lib/alerts/signalMonitor')
        .then(({ runSignalMonitorCheck }) => runSignalMonitorCheck())
        .catch((err) => console.warn('[server-poller] signal monitor tick error:', err));
    }, 30_000);
  }
}

export function stopServerAlertPoller(): void {
  if (globalThis._rmcServerPollerTimer) {
    clearInterval(globalThis._rmcServerPollerTimer);
    globalThis._rmcServerPollerTimer = undefined;
    console.log('[server-poller] Stopped server alert poller');
  }
  if (globalThis._rmcSignalMonitorTimer) {
    clearInterval(globalThis._rmcSignalMonitorTimer);
    globalThis._rmcSignalMonitorTimer = undefined;
  }
}
