import { describe, it, expect } from 'vitest';
import { isEquitySymbol, MAG7_SYMBOLS } from '@/lib/exchange/equities';

describe('Symbol Validation Logic', () => {
  it('identifies all Mag7 as equities so they never coerce to USDT', () => {
    for (const sym of MAG7_SYMBOLS) {
      expect(isEquitySymbol(sym)).toBe(true);
      expect(`${sym}USDT`).not.toBe(sym);
    }
  });

  it('rejects crypto tickers from equity classification', () => {
    expect(isEquitySymbol('BTC')).toBe(false);
    expect(isEquitySymbol('ETH')).toBe(false);
    expect(isEquitySymbol('SOL')).toBe(false);
    expect(isEquitySymbol('PEPE')).toBe(false);
  });
});
