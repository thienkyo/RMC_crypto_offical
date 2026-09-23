import { describe, it, expect } from 'vitest';
import { getUSEquityMarketStatus } from './marketHours';

describe('US Equity Market Hours (RTH)', () => {
  it('identifies regular trading hours on a Wednesday at 11:00 AM ET', () => {
    // 2026-09-23 15:00:00 UTC is 11:00 AM EDT (UTC-4)
    const midDay = new Date('2026-09-23T15:00:00Z');
    const status = getUSEquityMarketStatus(midDay);
    expect(status.isOpen).toBe(true);
    expect(status.session).toBe('regular');
    expect(status.label).toBe('Market open');
  });

  it('identifies market closed on weekend (Saturday)', () => {
    // 2026-09-26 is a Saturday
    const sat = new Date('2026-09-26T16:00:00Z');
    const status = getUSEquityMarketStatus(sat);
    expect(status.isOpen).toBe(false);
    expect(status.session).toBe('closed');
    expect(status.label).toBe('Market closed');
  });

  it('identifies market closed at night (2:00 AM ET)', () => {
    // 2026-09-23 06:00:00 UTC is 2:00 AM EDT
    const night = new Date('2026-09-23T06:00:00Z');
    const status = getUSEquityMarketStatus(night);
    expect(status.isOpen).toBe(false);
    expect(status.session).toBe('closed');
    expect(status.label).toBe('Market closed');
  });

  it('identifies pre-market hours (8:00 AM ET)', () => {
    // 2026-09-23 12:00:00 UTC is 8:00 AM EDT
    const preMarket = new Date('2026-09-23T12:00:00Z');
    const status = getUSEquityMarketStatus(preMarket);
    expect(status.isOpen).toBe(false);
    expect(status.session).toBe('pre-market');
    expect(status.label).toBe('Market closed');
  });

  it('identifies US holiday as closed (July 4th)', () => {
    // 2026-07-03 Friday (Independence day observed)
    const holiday = new Date('2026-07-03T15:00:00Z');
    const status = getUSEquityMarketStatus(holiday);
    expect(status.isOpen).toBe(false);
    expect(status.label).toBe('Market closed');
  });
});
