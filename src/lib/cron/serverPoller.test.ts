import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getServerPollIntervalMs,
  startServerAlertPoller,
  stopServerAlertPoller,
} from './serverPoller';

describe('ServerAlertPoller', () => {
  afterEach(() => {
    stopServerAlertPoller();
    delete process.env['ALERT_POLL_INTERVAL_MS'];
  });

  it('defaults to 5 minutes (300,000 ms)', () => {
    delete process.env['ALERT_POLL_INTERVAL_MS'];
    expect(getServerPollIntervalMs()).toBe(300_000);
  });

  it('respects valid ALERT_POLL_INTERVAL_MS environment variable', () => {
    process.env['ALERT_POLL_INTERVAL_MS'] = '600000';
    expect(getServerPollIntervalMs()).toBe(600_000);
  });

  it('ignores invalid or sub-minute ALERT_POLL_INTERVAL_MS', () => {
    process.env['ALERT_POLL_INTERVAL_MS'] = '1000'; // 1 second is too small
    expect(getServerPollIntervalMs()).toBe(300_000);
  });

  it('starts and stops cleanly without throwing', () => {
    expect(() => startServerAlertPoller()).not.toThrow();
    expect(globalThis._rmcServerPollerTimer).toBeDefined();
    expect(() => stopServerAlertPoller()).not.toThrow();
    expect(globalThis._rmcServerPollerTimer).toBeUndefined();
  });
});
