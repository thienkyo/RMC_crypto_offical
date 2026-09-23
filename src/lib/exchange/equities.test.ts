import { describe, it, expect } from 'vitest';
import { isEquitySymbol, MAG7_SYMBOLS, AI_BASKET_SYMBOLS } from './equities';
import { toYahooParams } from './yahoo';
import { toPolygonParams } from './polygon';

describe('Equities Provider & Helpers', () => {
  it('correctly identifies Mag7 and AI basket symbols', () => {
    for (const sym of MAG7_SYMBOLS) {
      expect(isEquitySymbol(sym)).toBe(true);
      expect(isEquitySymbol(sym.toLowerCase())).toBe(true);
    }
    for (const sym of AI_BASKET_SYMBOLS) {
      expect(isEquitySymbol(sym)).toBe(true);
    }
    expect(isEquitySymbol('BTC')).toBe(false);
    expect(isEquitySymbol('BTCUSDT')).toBe(false);
    expect(isEquitySymbol('ETH')).toBe(false);
  });

  it('maps timeframes to Yahoo interval and range correctly', () => {
    expect(toYahooParams('1m')).toEqual({ interval: '1m', range: '1d' });
    expect(toYahooParams('1h')).toEqual({ interval: '60m', range: '1y' });
    expect(toYahooParams('1d')).toEqual({ interval: '1d', range: '5y' });
    expect(toYahooParams('1w')).toEqual({ interval: '1wk', range: '10y' });
  });

  it('maps timeframes to Polygon multiplier and timespan correctly', () => {
    const p1h = toPolygonParams('1h');
    expect(p1h.multiplier).toBe(1);
    expect(p1h.timespan).toBe('hour');

    const p1d = toPolygonParams('1d');
    expect(p1d.multiplier).toBe(1);
    expect(p1d.timespan).toBe('day');

    const p15m = toPolygonParams('15m');
    expect(p15m.multiplier).toBe(15);
    expect(p15m.timespan).toBe('minute');
  });
});
