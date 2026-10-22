import { describe, it, expect } from 'vitest';
import { generateSignalChartSvg, generateSignalChartPng } from './signalChart';
import type { Candle } from '@/types/market';

describe('signalChart', () => {
  const mockCandles: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const base = 50000 + i * 20;
    const open = base + (i % 2 === 0 ? -15 : 15);
    const close = base + (i % 2 === 0 ? 30 : -25);
    return {
      openTime: 1700000000000 + i * 4 * 3600 * 1000,
      open,
      high: Math.max(open, close) + 20,
      low: Math.min(open, close) - 20,
      close,
      volume: 1000 + i * 50,
      closeTime: 1700000000000 + (i + 1) * 4 * 3600 * 1000 - 1,
    };
  });

  it('generates a valid SVG string with all key elements', () => {
    const svg = generateSignalChartSvg({
      symbol: 'BTCUSDT',
      timeframe: '4h',
      strategyName: 'RSI Momentum Breakout',
      direction: 'long',
      rating: 4,
      entryPrice: 51200,
      entryPriceLimit: 51400,
      stopLossPrice: 50100,
      takeProfitPrice: 53500,
      stopLossPct: 2.1,
      takeProfitPct: 4.5,
      candles: mockCandles,
      signalId: 1024,
    });

    expect(svg).toContain('<svg');
    expect(svg).toContain('BTCUSDT');
    expect(svg).toContain('4H');
    expect(svg).toContain('LONG ▲');
    expect(svg).toContain('sig#1024');
    expect(svg).toContain('RSI Momentum Breakout');
    expect(svg).toContain('ENTRY:');
    expect(svg).toContain('SL:');
    expect(svg).toContain('TP:');
    expect(svg).toContain('MAX:');
    expect(svg).toContain('▲ BUY');
  });

  it('generates a valid PNG Buffer via sharp', async () => {
    const buffer = await generateSignalChartPng({
      symbol: 'ETHUSDT',
      timeframe: '1h',
      strategyName: 'MACD Divergence Short',
      direction: 'short',
      rating: 5,
      entryPrice: 3200,
      stopLossPrice: 3300,
      takeProfitPrice: 3000,
      candles: mockCandles,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // PNG header check: \x89PNG\r\n\x1a\n
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4e); // N
    expect(buffer[3]).toBe(0x47); // G
  });
});
