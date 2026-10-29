import { describe, it, expect } from 'vitest';
import {
  formatChartPrice,
  formatUsdPrice,
  formatAxisPrice,
  formatSignedPct,
  formatIndicatorValue,
  escapeHtml,
  formatUtc7Timestamp,
} from './format';

describe('format utilities', () => {
  it('formats chart prices with adaptive decimals', () => {
    expect(formatChartPrice(62840.5)).toBe('62,840.50');
    expect(formatChartPrice(0.042319)).toBe('0.042319');
  });

  it('formats USD prices with dollar sign across tiers', () => {
    expect(formatUsdPrice(62840.5)).toBe('$62,841');
    expect(formatUsdPrice(12.345)).toBe('$12.35');
    expect(formatUsdPrice(0.042319)).toBe('$0.042319');
    expect(formatUsdPrice(0.042319, 4)).toBe('$0.0423');
  });

  it('formats SVG axis prices across tiers', () => {
    expect(formatAxisPrice(62840.5)).toBe('62,840.50');
    expect(formatAxisPrice(5.1234)).toBe('5.1234');
    expect(formatAxisPrice(0.042319)).toBe('0.042319');
  });

  it('formats signed percentages and indicator values', () => {
    expect(formatSignedPct(2.456)).toBe('+2.46%');
    expect(formatSignedPct(-1.2)).toBe('-1.20%');
    expect(formatIndicatorValue(NaN)).toBe('—');
    expect(formatIndicatorValue(50)).toBe('50');
    expect(formatIndicatorValue(125.67)).toBe('125.7');
    expect(formatIndicatorValue(12.345)).toBe('12.35');
    expect(formatIndicatorValue(0.04231)).toBe('0.0423');
  });

  it('escapes HTML and formats UTC+7 timestamps', () => {
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    // 2026-05-28 00:00:00 UTC -> 2026-05-28 07:00 (UTC+7)
    const ts = Date.UTC(2026, 4, 28, 0, 0, 0);
    expect(formatUtc7Timestamp(ts)).toBe('2026-05-28 07:00 (UTC+7)');
  });
});
