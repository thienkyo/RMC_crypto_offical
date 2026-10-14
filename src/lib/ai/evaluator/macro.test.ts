import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateMarketFlush, type FiredSignalSummary } from './macro';

vi.mock('@/lib/db/aiSettings', () => ({
  getAiKey: vi.fn(),
  getAiModel: vi.fn(),
}));

describe('evaluateMarketFlush (Macro Evaluator)', () => {
  const dummySignals: FiredSignalSummary[] = [
    { strategyName: 'L_BTC', symbol: 'BTCUSDT', timeframe: '4h', direction: 'long', entryPrice: 60000, rating: 5 },
    { strategyName: 'L_ETH', symbol: 'ETHUSDT', timeframe: '4h', direction: 'long', entryPrice: 2400, rating: 4 },
    { strategyName: 'L_SOL', symbol: 'SOLUSDT', timeframe: '4h', direction: 'long', entryPrice: 130, rating: 4 },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns structured fallback evaluation if no API key is set', async () => {
    const { getAiKey } = await import('@/lib/db/aiSettings');
    (getAiKey as any).mockResolvedValue(undefined);

    const result = await evaluateMarketFlush(dummySignals, Date.now());

    expect(result.verdict).toBe('CAVEAT');
    expect(result.confidence).toBe('medium');
    expect(result.summary).toContain('Cluster of 3 signals');
    expect(result.keyRisks).toBeInstanceOf(Array);
    expect(result.recommendedAction).toBeDefined();
  });

  it('calls Gemini API and parses valid JSON response when key is present', async () => {
    const { getAiKey, getAiModel } = await import('@/lib/db/aiSettings');
    (getAiKey as any).mockResolvedValue('fake-key');
    (getAiModel as any).mockResolvedValue('gemini-2.5-flash');

    const originalFetch = global.fetch;
    const mockJson = {
      verdict: 'PASS',
      confidence: 'high',
      summary: 'Broad market accumulation bounce from major 4h support.',
      correlationContext: 'BTC and ETH bounced cleanly off 200 EMA.',
      keyRisks: ['Slippage on fast moves'],
      recommendedAction: 'Favor top 2 volume pairs.',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(mockJson) }] } }],
      }),
    } as any);

    try {
      const result = await evaluateMarketFlush(dummySignals, Date.now());
      expect(result.verdict).toBe('PASS');
      expect(result.confidence).toBe('high');
      expect(result.summary).toBe(mockJson.summary);
      expect(result.keyRisks).toContain('Slippage on fast moves');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
