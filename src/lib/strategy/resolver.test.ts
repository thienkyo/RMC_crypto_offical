import { describe, it, expect } from 'vitest';
import { evaluateSignalOutcome } from './resolver';

describe('evaluateSignalOutcome', () => {
  const baseSignal = {
    direction: 'long' as const,
    entry_price: 100,
    stop_loss_pct: 2,   // SL = 98
    take_profit_pct: 4, // TP = 104
    candle_time: 1000,
  };

  it('detects long Take Profit', () => {
    const candles = [
      { openTime: 1000, closeTime: 1500, open: 100, high: 101, low: 99, close: 100 },
      { openTime: 2000, closeTime: 2500, open: 100, high: 105, low: 99, close: 103 },
    ];
    const res = evaluateSignalOutcome(baseSignal, candles);
    expect(res.resolved).toBe(true);
    expect(res.actualExitPrice).toBe(104);
    expect(res.pnlPct).toBe(4);
    expect(res.outcomeAt).toBe(2500);
    expect(res.outcomeNote).toContain('TP hit');
  });

  it('detects long Stop Loss', () => {
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 101, low: 97, close: 98 },
    ];
    const res = evaluateSignalOutcome(baseSignal, candles);
    expect(res.resolved).toBe(true);
    expect(res.actualExitPrice).toBe(98);
    expect(res.pnlPct).toBe(-2);
    expect(res.outcomeAt).toBe(2500);
    expect(res.outcomeNote).toContain('SL hit');
  });

  it('detects short Take Profit', () => {
    const shortSignal = {
      ...baseSignal,
      direction: 'short' as const, // TP = 96, SL = 102
    };
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 101, low: 95, close: 97 },
    ];
    const res = evaluateSignalOutcome(shortSignal, candles);
    expect(res.resolved).toBe(true);
    expect(res.actualExitPrice).toBe(96);
    expect(res.pnlPct).toBe(4);
  });

  it('detects short Stop Loss', () => {
    const shortSignal = {
      ...baseSignal,
      direction: 'short' as const, // TP = 96, SL = 102
    };
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 103, low: 99, close: 102 },
    ];
    const res = evaluateSignalOutcome(shortSignal, candles);
    expect(res.resolved).toBe(true);
    expect(res.actualExitPrice).toBe(102);
    expect(res.pnlPct).toBe(-2);
  });

  it('assumes conservative Stop Loss when both TP and SL are breached in the same candle', () => {
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 110, low: 90, close: 105 },
    ];
    const res = evaluateSignalOutcome(baseSignal, candles);
    expect(res.resolved).toBe(true);
    expect(res.actualExitPrice).toBe(98);
    expect(res.pnlPct).toBe(-2);
  });

  it('returns resolved: false if trade has not hit TP or SL', () => {
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 102, low: 99, close: 101 },
    ];
    const res = evaluateSignalOutcome(baseSignal, candles);
    expect(res.resolved).toBe(false);
  });

  it('fills pullback limit order on a 2% dip instead of stopping out, then hits TP', () => {
    // Signal at 100 with 2% limit entry (98), SL = 2% (96.04), TP = 4% (101.92)
    // In market mode, dipping to 98 triggers SL (-2%).
    // In limit mode, dipping to 98 fills the entry, and the next bar hitting 102 triggers TP (+4%)!
    const signalWithLimit = {
      ...baseSignal,
      entry_price_limit: 98,
    };
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 100.5, low: 97.8, close: 99 },
      { openTime: 3000, closeTime: 3500, open: 99, high: 102.5, low: 98.5, close: 102 },
    ];
    const marketRes = evaluateSignalOutcome(signalWithLimit, candles, { entryMode: 'market' });
    expect(marketRes.pnlPct).toBe(-2);

    const limitRes = evaluateSignalOutcome(signalWithLimit, candles, { entryMode: 'limit' });
    expect(limitRes.resolved).toBe(true);
    expect(limitRes.actualEntryPrice).toBe(98);
    expect(limitRes.pnlPct).toBe(4);
    expect(limitRes.outcomeNote).toContain('Auto (Limit): TP hit');
  });

  it('marks limit order as expired when price never pulls back within maxWaitBars', () => {
    const signalWithLimit = {
      ...baseSignal,
      entry_price_limit: 98,
    };
    const candles = [
      { openTime: 2000, closeTime: 2500, open: 100, high: 103, low: 99.5, close: 102 },
      { openTime: 3000, closeTime: 3500, open: 102, high: 104, low: 101, close: 103 },
    ];
    const res = evaluateSignalOutcome(signalWithLimit, candles, {
      entryMode: 'limit',
      maxWaitBars: 2,
    });
    expect(res.resolved).toBe(false);
    expect(res.expired).toBe(true);
    expect(res.outcomeNote).toContain('Limit unfilled');
  });

  it('locks in +0.15R profit when breakevenAt1R is enabled and trade reverses after +1R', () => {
    // Entry 100, SL 2% (98), TP 4% (104). +1R is 102.
    const candles = [
      // Bar 1 reaches 102.5 (+1R achieved, but below 104 TP)
      { openTime: 2000, closeTime: 2500, open: 100, high: 102.5, low: 99.5, close: 102 },
      // Bar 2 reverses down to 97
      { openTime: 3000, closeTime: 3500, open: 102, high: 102.1, low: 97, close: 97.5 },
    ];
    const res = evaluateSignalOutcome(baseSignal, candles, {
      entryMode: 'market',
      breakevenAt1R: true,
    });
    expect(res.resolved).toBe(true);
    expect(res.pnlPct).toBe(0.3);
    expect(res.outcomeNote).toContain('1R Trailing SL (+0.30%)');
  });
});
