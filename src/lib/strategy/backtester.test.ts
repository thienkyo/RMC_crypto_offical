import { describe, it, expect } from 'vitest';
import { runBacktest } from './backtester';
import type { Strategy } from '@/types/strategy';
import type { Candle } from '@/types/market';
import { createMockCandles } from '@/test/probes/chartProbes';

describe('Realistic Futures Backtester (Fees, Slippage & Funding)', () => {
  const createTestStrategy = (overrides: Partial<Strategy> = {}): Strategy => ({
    id: 'test-strat-1',
    name: 'Test Strategy',
    description: 'Testing backtest mechanics',
    version: 1,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    isActive: true,
    entryConditions: [
      {
        id: 'g1',
        label: 'Entry Group',
        conditions: [
          // Close > Open triggers entry
          {
            id: 'c1',
            indicatorId: 'rsi',
            params: { period: 14, emaPeriod: 10 },
            seriesIndex: 0,
            operator: 'gt',
            value: 0,
          },
        ],
      },
    ],
    exitConditions: [],
    action: {
      type: 'enter_long',
      positionSizePct: 50, // 50% capital
      maxPositions: 1,
      entryPriceOffset: { mode: 'pct', value: 0 }, // market entry
    },
    risk: {
      stopLossPct: 0,
      takeProfitPct: 0,
    },
    ...overrides,
  });

  it('erodes Long position PnL over multi-day holding period via 8-hour funding rates', () => {
    // 5 days = 120 1-hour candles = 15 funding intervals (120 / 8)
    const candles = createMockCandles(120, 50000, 1700000000000, 3600000);
    const strat = createTestStrategy({
      risk: { stopLossPct: 0, takeProfitPct: 0 },
    });

    // Run A: With funding disabled (spot-like)
    const resNoFunding = runBacktest(strat, candles, {
      initialCapital: 10000,
      enableFunding: false,
    });

    // Run B: With 0.01% 8h funding enabled (futures standard)
    const resWithFunding = runBacktest(strat, candles, {
      initialCapital: 10000,
      enableFunding: true,
      fundingRate8hPct: 0.01,
    });

    expect(resNoFunding.trades.length).toBe(1);
    expect(resWithFunding.trades.length).toBe(1);

    const tradeNoFunding = resNoFunding.trades[0]!;
    const tradeWithFunding = resWithFunding.trades[0]!;

    expect(tradeNoFunding.fundingPaid).toBe(0);
    expect(tradeWithFunding.fundingPaid).toBeGreaterThan(0);

    // Capital allocated = 50% of 10,000 = $5,000.
    // 14 or 15 8-hour intervals crossed.
    // Funding cost = $5000 * 0.0001 * 14 = ~$7.00
    expect(tradeWithFunding.fundingPaid).toBeCloseTo(7.0, 0);

    // Net PnL in futures is lower due to funding drag
    expect(tradeWithFunding.pnlAbs).toBeLessThan(tradeNoFunding.pnlAbs);
    expect(resWithFunding.metrics.totalFundingPaid).toBeCloseTo(tradeWithFunding.fundingPaid!, 2);
  });

  it('credits funding income to Short positions during positive funding rates', () => {
    const candles = createMockCandles(120, 50000, 1700000000000, 3600000);
    const shortStrat = createTestStrategy({
      action: {
        type: 'enter_short',
        positionSizePct: 100,
        maxPositions: 1,
        entryPriceOffset: { mode: 'pct', value: 0 },
      },
    });

    const res = runBacktest(shortStrat, candles, {
      initialCapital: 10000,
      enableFunding: true,
      fundingRate8hPct: 0.01, // longs pay shorts
    });

    expect(res.trades.length).toBe(1);
    const trade = res.trades[0]!;

    // Negative fundingPaid means funding income credited to short seller
    expect(trade.fundingPaid).toBeLessThan(0);
    expect(res.metrics.totalFundingPaid).toBeLessThan(0);
  });

  it('applies Maker fees (0.02%) and 0 slippage to limit orders, Taker fees (0.05%) to market fills', () => {
    // 25 candles where bars 0-19 are around 100, bar 20 drops to 94 (fills limit at 98), bar 21 surges to 120 (hits TP)
    const candles: Candle[] = createMockCandles(25, 100, 1700000000000, 3600000);
    // Bar 20 dips low enough to fill a 2% limit order
    candles[20] = { ...candles[20]!, open: 100, high: 101, low: 94, close: 96 };
    // Bar 21 spikes high enough to trigger 10% TP
    candles[21] = { ...candles[21]!, open: 96, high: 120, low: 95, close: 115 };

    // Limit entry strategy (2% limit offset below close of bar -> limit at 98)
    const limitStrat = createTestStrategy({
      entryConditions: [
        {
          id: 'g1',
          label: 'Entry Group',
          conditions: [
            {
              id: 'c1',
              indicatorId: 'sma',
              params: { period: 2 },
              seriesIndex: 0,
              operator: 'gt',
              value: 0,
            },
          ],
        },
      ],
      action: {
        type: 'enter_long',
        positionSizePct: 100,
        maxPositions: 1,
        entryPriceOffset: { mode: 'pct', value: 2 },
      },
      risk: { stopLossPct: 0, takeProfitPct: 10 }, // 10% TP limit
    });

    const res = runBacktest(limitStrat, candles, {
      initialCapital: 10000,
      makerFeePct: 0.02,
      takerFeePct: 0.05,
      slippagePct: 0.02,
      enableFunding: false,
    });

    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    const trade = res.trades[0]!;

    // Entry filled as limit (Maker) and exit was take_profit (Maker)
    expect(trade.exitReason).toBe('take_profit');
    // Total fees = 0.02% entry + 0.02% exit = 0.04% of capital (~$4.00)
    expect(trade.feesPaid).toBeCloseTo(4.0, 1);
    // Slippage should be 0 because both were Maker orders!
    expect(trade.slippagePaid).toBe(0);
  });

  it('penalises stop-loss market orders with elevated volatility slippage', () => {
    const candles: Candle[] = createMockCandles(25, 100, 1700000000000, 3600000);
    // Bar 20 crashes down through the 5% SL
    candles[20] = { ...candles[20]!, open: 100, high: 100, low: 85, close: 88 };

    const slStrat = createTestStrategy({
      entryConditions: [
        {
          id: 'g1',
          label: 'Entry Group',
          conditions: [
            {
              id: 'c1',
              indicatorId: 'sma',
              params: { period: 2 },
              seriesIndex: 0,
              operator: 'gt',
              value: 0,
            },
          ],
        },
      ],
      action: {
        type: 'enter_long',
        positionSizePct: 100,
        maxPositions: 1,
        entryPriceOffset: { mode: 'pct', value: 0 },
      },
      risk: { stopLossPct: 5, takeProfitPct: 0 },
    });

    const res = runBacktest(slStrat, candles, {
      initialCapital: 10000,
      slippagePct: 0.02,
      stopLossSlippagePct: 0.05,
      enableFunding: false,
    });

    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    const trade = res.trades[0]!;
    expect(trade.exitReason).toBe('stop_loss');

    // Slippage includes base 0.02% entry + (0.02% + 0.05%) exit = 0.09% total
    expect(trade.slippagePaid).toBeGreaterThan(5); // on $10k, 0.09% = ~$9
  });

  it('automatically disables funding rate calculations for US equities', () => {
    const candles = createMockCandles(120, 150, 1700000000000, 3600000);
    const equityStrat = createTestStrategy({
      symbol: 'AAPL', // Equity ticker
    });

    const res = runBacktest(equityStrat, candles, {
      initialCapital: 10000,
    });

    expect(res.trades.length).toBe(1);
    const trade = res.trades[0]!;
    expect(trade.fundingPaid).toBe(0);
    expect(res.metrics.totalFundingPaid).toBe(0);
  });
});
