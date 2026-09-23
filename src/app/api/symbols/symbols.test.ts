import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import {
  MAG7_SYMBOLS,
  AI_BASKET_SYMBOLS,
  HARDWARE_SYMBOLS,
  AI_HARDWARE_SYMBOLS,
  isEquitySymbol,
} from '@/lib/exchange/equities';

describe('Symbols API and Basket Definitions', () => {
  it('has locked Mag7 symbols roster', () => {
    const expectedMag7 = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'];
    expect([...MAG7_SYMBOLS]).toEqual(expectedMag7);
    for (const sym of expectedMag7) {
      expect(isEquitySymbol(sym)).toBe(true);
    }
  });

  it('has expanded AI & Hardware basket roster including RAM, HDD, and chips', () => {
    const expectedStarters = [
      'NVDA', 'AVGO', 'AMD', 'TSM', 'ASML', 'MU', 'WDC', 'STX', 'SMCI', 'ARM', 'PLTR',
    ];
    expect([...AI_BASKET_SYMBOLS]).toEqual(expectedStarters);

    const expectedHardware = [
      'INTC', 'DELL', 'QCOM', 'MRVL', 'AMAT', 'LRCX', 'KLAC', 'VRT', 'ANET', 'PSTG', 'HPE',
    ];
    expect([...HARDWARE_SYMBOLS]).toEqual(expectedHardware);

    for (const sym of AI_HARDWARE_SYMBOLS) {
      expect(isEquitySymbol(sym)).toBe(true);
    }
  });

  it('recognizes dynamic US equities and strictly rejects crypto', () => {
    // Dynamic US stocks outside pre-configured lists
    expect(isEquitySymbol('IBM')).toBe(true);
    expect(isEquitySymbol('ORCL')).toBe(true);
    expect(isEquitySymbol('TXN')).toBe(true);

    // Crypto must be rejected
    expect(isEquitySymbol('BTC')).toBe(false);
    expect(isEquitySymbol('ETH')).toBe(false);
    expect(isEquitySymbol('SOL')).toBe(false);
    expect(isEquitySymbol('PEPE')).toBe(false);
    expect(isEquitySymbol('BTCUSDT')).toBe(false);
    expect(isEquitySymbol('ETHUSDT')).toBe(false);
  });

  it('GET /api/symbols returns crypto, mag7, and ai & hardware baskets with proper sources', async () => {
    // Mock fetch to avoid real network calls during test
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline in unit test'));

    try {
      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();

      expect(json).toHaveProperty('crypto');
      expect(json).toHaveProperty('mag7');
      expect(json).toHaveProperty('ai');
      expect(json).toHaveProperty('equities'); // backwards compatibility
      expect(json.stale).toBe(true); // fallback used when fetch fails

      // Verify Mag7
      expect(json.mag7.map((s: { symbol: string }) => s.symbol)).toEqual([
        'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
      ]);
      for (const item of json.mag7) {
        expect(item.source).toBe('equities');
        expect(item.quoteAsset).toBe('USD');
      }

      // Verify AI & Hardware basket contains all 22 symbols
      const aiSymbols = json.ai.map((s: { symbol: string }) => s.symbol);
      for (const expected of AI_HARDWARE_SYMBOLS) {
        expect(aiSymbols).toContain(expected);
      }
      expect(aiSymbols.length).toBe(22);

      for (const item of json.ai) {
        expect(item.source).toBe('equities');
        expect(item.quoteAsset).toBe('USD');
      }

      // Verify RAM (MU), HDD (WDC, STX), and Chips (INTC, NVDA, AMD, TSM, etc.)
      expect(aiSymbols).toContain('MU');
      expect(aiSymbols).toContain('WDC');
      expect(aiSymbols).toContain('STX');
      expect(aiSymbols).toContain('INTC');
      expect(aiSymbols).toContain('DELL');
      expect(aiSymbols).toContain('QCOM');

      // Verify NVDA is present in both Mag7 and AI
      expect(json.mag7.some((s: { symbol: string }) => s.symbol === 'NVDA')).toBe(true);
      expect(json.ai.some((s: { symbol: string }) => s.symbol === 'NVDA')).toBe(true);

      // Verify crypto fallback
      expect(json.crypto.length).toBeGreaterThan(0);
      expect(json.crypto[0].symbol).toBe('BTCUSDT');
      expect(json.crypto[0].source).toBe('binance');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
