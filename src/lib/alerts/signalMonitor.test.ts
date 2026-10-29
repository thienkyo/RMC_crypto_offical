import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTradeDuration,
  getNextHeartbeatMilestoneMs,
  registerOrConfirmSignalMonitor,
  runSignalMonitorCheck,
  type SignalMonitorRow,
} from './signalMonitor';
import { db } from '@/lib/db/client';
import { sendTelegramAlert } from '@/lib/alerts/telegram';

vi.mock('@/lib/db/client', () => ({
  db: {
    query: vi.fn(),
  },
}));

vi.mock('@/lib/alerts/telegram', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue({ ok: true, delivered: 1 }),
}));

describe('Signal Monitor Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatTradeDuration', () => {
    it('formats minutes, hours, and days cleanly', () => {
      expect(formatTradeDuration(45 * 60_000)).toBe('45m');
      expect(formatTradeDuration(2 * 3600_000)).toBe('2h');
      expect(formatTradeDuration(2 * 3600_000 + 15 * 60_000)).toBe('2h 15m');
      expect(formatTradeDuration(25 * 3600_000)).toBe('1d 1h');
    });
  });

  describe('getNextHeartbeatMilestoneMs', () => {
    it('follows 15m -> 30m -> 60m -> 4h ... -> 48h schedule', () => {
      expect(getNextHeartbeatMilestoneMs(0)).toBe(15 * 60_000);
      expect(getNextHeartbeatMilestoneMs(15 * 60_000)).toBe(30 * 60_000);
      expect(getNextHeartbeatMilestoneMs(30 * 60_000)).toBe(60 * 60_000);
      expect(getNextHeartbeatMilestoneMs(60 * 60_000)).toBe(4 * 3600_000);
      expect(getNextHeartbeatMilestoneMs(4 * 3600_000)).toBe(8 * 3600_000);
      expect(getNextHeartbeatMilestoneMs(44 * 3600_000)).toBe(48 * 3600_000);
      expect(getNextHeartbeatMilestoneMs(48 * 3600_000)).toBeNull();
    });
  });

  describe('registerOrConfirmSignalMonitor', () => {
    it('creates a fresh active monitor when no trade is open', async () => {
      // 1. Check opposing: none
      // 2. Check active: none
      // 3. Insert fresh
      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] } as any) // opposing
        .mockResolvedValueOnce({ rows: [] } as any) // active
        .mockResolvedValueOnce({ rows: [{ id: 101 }] } as any); // insert

      const res = await registerOrConfirmSignalMonitor({
        strategyId: 'strat-1',
        strategyName: 'UTILMATE_L',
        symbol: 'NEARUSDT',
        timeframe: '4h',
        direction: 'long',
        entryPrice: 5.0,
        stopLossPct: 2,
        takeProfitPct: 4,
        telegramMessageId: 9999,
      });

      expect(res.action).toBe('created');
      expect(res.monitorId).toBe(101);
      expect(res.confluenceCount).toBe(1);

      // Verify calculation of SL (4.90) and TP (5.20) for Long
      const insertCall = vi.mocked(db.query).mock.calls[2]!;
      const params = insertCall[1] as any[];
      expect(params[6]).toBe(5.0); // entry_price
      expect(params[7]).toBe(4.9); // stop_loss_price (5.0 * 0.98)
      expect(params[8]).toBe(5.2); // take_profit_price (5.0 * 1.04)
    });

    it('confirms existing monitor instead of creating duplicate (Confluence rule)', async () => {
      const existingMonitor: Partial<SignalMonitorRow> = {
        id: 42,
        symbol: 'NEARUSDT',
        direction: 'long',
        entry_price: '5.0000',
        confluence_count: 1,
        telegram_message_id: '8888',
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [] } as any) // opposing
        .mockResolvedValueOnce({ rows: [existingMonitor] } as any) // active
        .mockResolvedValueOnce({ rows: [] } as any); // update

      const res = await registerOrConfirmSignalMonitor({
        strategyId: 'strat-2',
        strategyName: 'MACD_L',
        symbol: 'NEARUSDT',
        timeframe: '1h',
        direction: 'long',
        entryPrice: 5.05,
      });

      expect(res.action).toBe('confirmed');
      expect(res.monitorId).toBe(42);
      expect(res.confluenceCount).toBe(2);

      // Verify threaded reply sent to root message 8888
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Signal Confluence Boost (#2)'),
        'MACD_L',
        'signal',
        undefined,
        undefined,
        8888,
      );
    });

    it('warns active monitor thread when opposing signal fires (Directional Conflict)', async () => {
      const activeLong: Partial<SignalMonitorRow> = {
        id: 77,
        symbol: 'BTCUSDT',
        direction: 'long',
        entry_price: '80000',
        telegram_message_id: '7777',
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [activeLong] } as any) // opposing check found Long
        .mockResolvedValueOnce({ rows: [] } as any) // same-dir check found no Short
        .mockResolvedValueOnce({ rows: [{ id: 78 }] } as any); // insert

      const res = await registerOrConfirmSignalMonitor({
        strategyId: 'strat-short',
        strategyName: 'Bear_Sniper',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        direction: 'short',
        entryPrice: 80500,
        telegramMessageId: 8888,
      });

      expect(res.action).toBe('created');
      // Verify conflict warning was sent to the active Long thread (7777)
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Directional Conflict Warning'),
        'Bear_Sniper',
        'signal',
        undefined,
        undefined,
        7777,
      );
    });
  });

  describe('runSignalMonitorCheck', () => {
    it('arms breakeven when price moves half-way to target', async () => {
      const openTrade: Partial<SignalMonitorRow> = {
        id: 1,
        symbol: 'NEARUSDT',
        timeframe: '4h',
        direction: 'long',
        entry_price: '5.0000',
        stop_loss_price: '4.9000',
        take_profit_price: '5.2000', // 4% TP -> 2% breakeven threshold
        breakeven_price: '5.0000',
        is_breakeven_armed: false,
        max_price: '5.0000',
        min_price: '5.0000',
        max_profit_pct: '0',
        max_drawdown_pct: '0',
        status: 'open',
        telegram_message_id: '5555',
        strategy_name: 'UTILMATE_L',
        created_at: new Date(Date.now() - 3600_000),
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [openTrade] } as any) // active monitors query
        .mockResolvedValueOnce({ rows: [] } as any); // update query

      // Current price is 5.11 (+2.2% gain, > 2% breakeven threshold)
      const res = await runSignalMonitorCheck({ NEARUSDT: 5.11 });

      expect(res.breakevenArmed).toBe(1);
      expect(res.closed).toBe(0);

      // Verify Telegram reply sent with breakeven notice
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Stop Loss automatically moved to <b>Breakeven ($5.0000)</b>'),
        'UTILMATE_L',
        'signal',
        undefined,
        undefined,
        5555,
      );
    });

    it('closes trade with Take Profit when target price is crossed', async () => {
      const openTrade: Partial<SignalMonitorRow> = {
        id: 2,
        symbol: 'NEARUSDT',
        timeframe: '4h',
        direction: 'long',
        entry_price: '5.0000',
        stop_loss_price: '4.9000',
        take_profit_price: '5.2000',
        breakeven_price: '5.0000',
        is_breakeven_armed: true,
        max_price: '5.1500',
        min_price: '4.9900',
        max_profit_pct: '3.0',
        max_drawdown_pct: '-0.2',
        status: 'open',
        telegram_message_id: '5555',
        strategy_name: 'UTILMATE_L',
        created_at: new Date(Date.now() - 7200_000),
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [openTrade] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      // Current price is 5.22 (> 5.20 TP)
      const res = await runSignalMonitorCheck({ NEARUSDT: 5.22 });

      expect(res.closed).toBe(1);
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Target Reached! (Take Profit)'),
        'UTILMATE_L',
        'signal',
        undefined,
        undefined,
        5555,
      );
    });

    it('closes trade at Breakeven when protected and price pulls back to entry', async () => {
      const openTrade: Partial<SignalMonitorRow> = {
        id: 3,
        symbol: 'NEARUSDT',
        timeframe: '4h',
        direction: 'long',
        entry_price: '5.0000',
        stop_loss_price: '5.0000', // SL already moved to BE
        take_profit_price: '5.2000',
        breakeven_price: '5.0000',
        is_breakeven_armed: true,
        max_price: '5.1200',
        min_price: '4.9900',
        max_profit_pct: '2.4',
        max_drawdown_pct: '-0.2',
        status: 'open',
        telegram_message_id: '5555',
        strategy_name: 'UTILMATE_L',
        created_at: new Date(Date.now() - 10800_000),
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [openTrade] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      // Current price drops to 4.995 (<= 5.00 BE stop)
      const res = await runSignalMonitorCheck({ NEARUSDT: 4.995 });

      expect(res.closed).toBe(1);
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Breakeven Protected Exit'),
        'UTILMATE_L',
        'signal',
        undefined,
        undefined,
        5555,
      );
    });

    it('sends tiered heartbeat at 15m and auto-expires trade at 48h', async () => {
      const createdAt16mAgo = new Date(Date.now() - 16 * 60_000);
      const openTrade15m: Partial<SignalMonitorRow> = {
        id: 4,
        symbol: 'ETHUSDT',
        timeframe: '4h',
        direction: 'long',
        entry_price: '2369.0000',
        stop_loss_price: '2307.2656',
        take_profit_price: '2431.0000',
        breakeven_price: '2369.0000',
        is_breakeven_armed: false,
        max_price: '2369.0000',
        min_price: '2346.6200',
        max_profit_pct: '0',
        max_drawdown_pct: '-0.95',
        status: 'open',
        telegram_message_id: '6666',
        strategy_name: 'UTILMATE_L',
        created_at: createdAt16mAgo,
        last_heartbeat_at: createdAt16mAgo,
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [openTrade15m] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const res15m = await runSignalMonitorCheck({ ETHUSDT: 2350.0 });
      expect(res15m.heartbeatsSent).toBe(1);
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('Progress Update (15m Check-in • 4H)'),
        'UTILMATE_L',
        'signal',
        undefined,
        undefined,
        6666,
      );

      // Now test 48h expiry
      const createdAt49hAgo = new Date(Date.now() - 49 * 3600_000);
      const expiredTrade: Partial<SignalMonitorRow> = {
        ...openTrade15m,
        id: 5,
        created_at: createdAt49hAgo,
        last_heartbeat_at: new Date(Date.now() - 5 * 3600_000),
      };

      vi.mocked(db.query)
        .mockResolvedValueOnce({ rows: [expiredTrade] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const resExp = await runSignalMonitorCheck({ ETHUSDT: 2380.0 });
      expect(resExp.closed).toBe(1);
      expect(sendTelegramAlert).toHaveBeenCalledWith(
        expect.stringContaining('48h Monitoring Complete (Final Summary)'),
        'UTILMATE_L',
        'signal',
        undefined,
        undefined,
        6666,
      );
    });
  });
});
