import { describe, it, expect } from 'vitest';
import { resolveStrategyTelegramTopic } from '@/lib/alerts/telegram';
import type { Strategy } from '@/types/strategy';

describe('Common Strategy — Logic & Routing', () => {
  it('resolves telegram topic name using {symbol} token or falls back to ticker', () => {
    // 1. Topic with {symbol} token
    const topicWithToken = resolveStrategyTelegramTopic(
      { enabled: true, name: '{symbol}' },
      'BTCUSDT',
    );
    expect(topicWithToken).toEqual({ enabled: true, name: 'BTCUSDT' });

    // 2. Topic with custom prefix and {symbol} token
    const topicWithCustom = resolveStrategyTelegramTopic(
      { enabled: true, name: 'Signals_{symbol}' },
      'ETHUSDT',
    );
    expect(topicWithCustom).toEqual({ enabled: true, name: 'Signals_ETHUSDT' });

    // 3. Topic with blank name falls back to symbol
    const topicBlank = resolveStrategyTelegramTopic(
      { enabled: true, name: '   ' },
      'SOLUSDT',
    );
    expect(topicBlank).toEqual({ enabled: true, name: 'SOLUSDT' });

    // 4. Specific topic name is preserved
    const topicSpecific = resolveStrategyTelegramTopic(
      { enabled: true, name: 'VIP_Signals' },
      'BTCUSDT',
    );
    expect(topicSpecific).toEqual({ enabled: true, name: 'VIP_Signals' });

    // 5. Common strategy with a stale ticker topic name falls back to active firing symbol
    const topicCommonSafeguard = resolveStrategyTelegramTopic(
      { enabled: true, name: 'BTCUSDT' },
      'ETHUSDT',
      true,
      ['BTCUSDT', 'ETHUSDT'],
    );
    expect(topicCommonSafeguard).toEqual({ enabled: true, name: 'ETHUSDT' });
  });

  it('matches common strategy symbols correctly against active chart', () => {
    const commonStrategy: Strategy = {
      id: 'common_1',
      name: 'Common RSI Strategy',
      description: '',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      symbol: 'BTCUSDT',
      timeframe: '1h',
      isActive: true,
      isCommon: true,
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT'],
      entryConditions: [],
      exitConditions: [],
      action: { type: 'enter_long', positionSizePct: 100, maxPositions: 1 },
      risk: { stopLossPct: 2, takeProfitPct: 4 },
    };

    const regularStrategy: Strategy = {
      ...commonStrategy,
      id: 'reg_1',
      name: 'Regular BTC Strategy',
      isCommon: false,
      symbols: undefined,
      symbol: 'BTCUSDT',
    };

    const all = [commonStrategy, regularStrategy];

    // Chart on BTCUSDT 1h -> should match both
    const btcMatches = all.filter(
      (s) =>
        s.isActive &&
        (s.symbol === 'BTCUSDT' || (s.isCommon && s.symbols?.includes('BTCUSDT'))) &&
        s.timeframe === '1h',
    );
    expect(btcMatches.map((s) => s.id)).toEqual(['common_1', 'reg_1']);

    // Chart on ETHUSDT 1h -> should match common_1 only
    const ethMatches = all.filter(
      (s) =>
        s.isActive &&
        (s.symbol === 'ETHUSDT' || (s.isCommon && s.symbols?.includes('ETHUSDT'))) &&
        s.timeframe === '1h',
    );
    expect(ethMatches.map((s) => s.id)).toEqual(['common_1']);

    // Chart on DOGEUSDT 1h -> neither should match
    const dogeMatches = all.filter(
      (s) =>
        s.isActive &&
        (s.symbol === 'DOGEUSDT' || (s.isCommon && s.symbols?.includes('DOGEUSDT'))) &&
        s.timeframe === '1h',
    );
    expect(dogeMatches.length).toBe(0);
  });
});
