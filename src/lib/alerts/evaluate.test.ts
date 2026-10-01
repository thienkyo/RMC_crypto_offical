import { describe, it, expect, vi } from 'vitest';
import { evaluateAlertRule } from './evaluate';
import * as marketHours from '@/lib/exchange/marketHours';
import type { AlertRule } from '@/types/alert';

describe('evaluateAlertRule — Market Hours Gate', () => {
  it('returns reason: market_closed when equity market is closed', async () => {
    vi.spyOn(marketHours, 'getUSEquityMarketStatus').mockReturnValue({
      isOpen: false,
      session: 'closed',
      label: 'Market Closed',
      easternTime: 'Sat 10:00',
    });

    const rule: AlertRule = {
      id: 'rule-aapl-1',
      name: 'AAPL RSI Oversold',
      symbol: 'AAPL',
      timeframe: '1h',
      enabled: true,
      condition: {
        id: 'cond-1',
        indicatorId: 'rsi',
        seriesIndex: 0,
        operator: 'lt',
        value: 30,
        params: { period: 14 },
      },
      cooldownMs: 3_600_000,
      lastFiredAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const res = await evaluateAlertRule(rule);
    expect(res.fired).toBe(false);
    if (!res.fired) {
      expect(res.reason).toBe('market_closed');
    }
  });
});
