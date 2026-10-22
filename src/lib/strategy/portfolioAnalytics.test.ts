import { describe, it, expect } from 'vitest';
import type { StrategySignalRow } from '@/lib/strategy/signalMetrics';
import {
  buildEquityPoints,
  buildBreakdown,
  buildTickerGroups,
  computeExtendedPortfolioMetrics,
} from '@/lib/strategy/portfolioAnalytics';

function makeSignal(overrides: Partial<StrategySignalRow> = {}): StrategySignalRow {
  return {
    id:                  1,
    strategy_id:         'strat-1',
    strategy_name:       'ICT Silver Bullet',
    symbol:              'BTCUSDT',
    timeframe:           '1h',
    direction:           'long',
    entry_price:         65000,
    stop_loss_pct:       2,
    take_profit_pct:     6,
    candle_time:         1700000000000,
    fired_at:            1700000000000,
    conditions_snapshot: null,
    actual_entry_price:  null,
    actual_exit_price:   null,
    pnl_pct:             null,
    outcome_note:        null,
    outcome_at:          null,
    telegram_delivered:  true,
    rating:              6,
    entry_price_limit:   63050,
    ai_evaluation:       null,
    ...overrides,
  };
}

describe('portfolioAnalytics', () => {
  it('computes equity curve, peak, and drawdown accurately', () => {
    const signals: StrategySignalRow[] = [
      makeSignal({ id: 1, pnl_pct: 6, outcome_at: 1000 }),
      makeSignal({ id: 2, pnl_pct: -2, outcome_at: 2000 }),
      makeSignal({ id: 3, pnl_pct: -3, outcome_at: 3000 }),
      makeSignal({ id: 4, pnl_pct: 8, outcome_at: 4000 }),
    ];

    const curve = buildEquityPoints(signals);
    expect(curve).toEqual([
      { time: 1000, value: 6, peak: 6, drawdown: 0 },
      { time: 2000, value: 4, peak: 6, drawdown: -2 },
      { time: 3000, value: 1, peak: 6, drawdown: -5 },
      { time: 4000, value: 9, peak: 9, drawdown: 0 },
    ]);

    const ext = computeExtendedPortfolioMetrics(signals, signals);
    expect(ext.peakPnl).toBe(9);
    expect(ext.maxDrawdown).toBe(-5);
    expect(ext.profitFactor).toBeCloseTo(14 / 5, 2);
    expect(ext.expectancy).toBeCloseTo(9 / 4, 2);
  });

  it('groups strategies by ticker symbol and sorts by net P&L', () => {
    const signals: StrategySignalRow[] = [
      makeSignal({ id: 1, strategy_id: 's1', strategy_name: 'Strat A', symbol: 'BTCUSDT', pnl_pct: 5, outcome_at: 1000 }),
      makeSignal({ id: 2, strategy_id: 's2', strategy_name: 'Strat B', symbol: 'BTCUSDT', pnl_pct: 4, outcome_at: 2000 }),
      makeSignal({ id: 3, strategy_id: 's3', strategy_name: 'Strat C', symbol: 'ETHUSDT', pnl_pct: 12, outcome_at: 3000 }),
    ];

    const breakdown = buildBreakdown(signals);
    const groups    = buildTickerGroups(breakdown);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.symbol).toBe('ETHUSDT');
    expect(groups[0]!.totalPnl).toBe(12);
    expect(groups[1]!.symbol).toBe('BTCUSDT');
    expect(groups[1]!.totalPnl).toBe(9);
    expect(groups[1]!.strategies).toHaveLength(2);
  });
});
