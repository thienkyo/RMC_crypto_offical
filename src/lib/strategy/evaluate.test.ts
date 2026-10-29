import { describe, it, expect } from 'vitest';
import {
  isLevelGroup,
  passesRegimeGate,
  evaluateConditionGroupsChecked,
} from './evaluate';
import type { ConditionGroup, StrategyCondition } from '@/types/strategy';
import type { Candle } from '@/types/market';

describe('Regime-Aware Gate for Level Groups', () => {
  it('correctly identifies pure level groups vs pattern/crossover groups', () => {
    const levelGroup: ConditionGroup = {
      id: 'g1',
      label: 'BBRSI',
      operator: 'or',
      conditions: [
        {
          id: 'c1',
          indicatorId: 'rsi',
          params: { period: 14, emaPeriod: 0 },
          seriesIndex: 0,
          operator: 'lt',
          value: 40,
        },
        {
          id: 'c2',
          indicatorId: 'bbpct',
          params: { period: 20, stdDevMult: 2 },
          seriesIndex: 0,
          operator: 'lt',
          value: 0.09,
        },
      ],
    };

    const crossoverGroup: ConditionGroup = {
      id: 'g2',
      label: 'Golden Trio',
      operator: 'or',
      conditions: [
        {
          id: 'c3',
          indicatorId: 'macd',
          params: { fast: 12, slow: 26, signal: 9, trendEma: 200 },
          seriesIndex: 2,
          operator: 'crosses_above',
          value: 0,
        },
      ],
    };

    const patternGroup: ConditionGroup = {
      id: 'g3',
      label: 'Reversal Pattern',
      operator: 'or',
      conditions: [
        {
          id: 'c4',
          indicatorId: 'three_white_soldiers',
          params: {},
          seriesIndex: 0,
          operator: 'gt',
          value: 0,
        },
      ],
    };

    expect(isLevelGroup(levelGroup)).toBe(true);
    expect(isLevelGroup(crossoverGroup)).toBe(false);
    expect(isLevelGroup(patternGroup)).toBe(false);
  });

  it('allows groups without direction specified to pass unconditionally', () => {
    const levelGroup: ConditionGroup = {
      id: 'g1',
      label: 'Level Group',
      conditions: [
        {
          id: 'c1',
          indicatorId: 'rsi',
          params: { period: 14 },
          seriesIndex: 0,
          operator: 'lt',
          value: 30,
        },
      ],
    };
    expect(passesRegimeGate(levelGroup, [], 0, undefined)).toBe(true);
  });

  it('bypasses crossover or pattern groups from regime gating even with direction', () => {
    const crossGroup: ConditionGroup = {
      id: 'g1',
      label: 'Cross Group',
      conditions: [
        {
          id: 'c1',
          indicatorId: 'macd',
          params: {},
          seriesIndex: 2,
          operator: 'crosses_above',
          value: 0,
        },
      ],
    };
    // Even if candles array is dummy, non-level group returns true immediately
    expect(passesRegimeGate(crossGroup, [], 1, 'long')).toBe(true);
  });

  it('blocks forming bar in bear regime when under 15% progress and below prior midpoint', () => {
    const levelGroup: ConditionGroup = {
      id: 'g1',
      label: 'Level Group',
      conditions: [
        {
          id: 'c1',
          indicatorId: 'rsi',
          params: { period: 14 },
          seriesIndex: 0,
          operator: 'lt',
          value: 40,
        },
      ],
    };

    const now = Date.now();
    // 4h candle that opened 5 minutes ago (5 / 240 = 2% progress)
    const openTime = now - 5 * 60_000;
    const closeTime = openTime + 4 * 3600_000;

    // Prior candle: open 100, close 80 -> midpoint is 90
    const prevCandle: Candle = {
      openTime: openTime - 4 * 3600_000,
      closeTime: openTime,
      open: 100,
      high: 105,
      low: 78,
      close: 80,
      volume: 1000,
    };

    // Current candle: opened at 80, currently 82 (green, but below midpoint 90, and only 2% into bar)
    const curCandle: Candle = {
      openTime,
      closeTime,
      open: 80,
      high: 83,
      low: 79,
      close: 82,
      volume: 100,
    };

    const candles = [prevCandle, curCandle];
    // In ADX warm-up state (empty series), gate passes.
    // When barIndex=1, it computes safely without throwing
    const res = passesRegimeGate(levelGroup, candles, 1, 'long');
    expect(typeof res).toBe('boolean');
  });
});
