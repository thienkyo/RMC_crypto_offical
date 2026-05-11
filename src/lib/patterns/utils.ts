import type { Candle } from '@/types/market';

export const isGreen = (c: Candle) => c.close > c.open;
export const isRed = (c: Candle) => c.close < c.open;
export const bodySize = (c: Candle) => Math.abs(c.close - c.open);
export const candleSize = (c: Candle) => c.high - c.low;
export const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
export const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low;

export const isDoji = (c: Candle) => {
  const body = bodySize(c);
  const total = candleSize(c);
  return total > 0 && body / total <= 0.1;
};

export const isLongBody = (c: Candle, avgBodySize: number) => {
  return bodySize(c) > avgBodySize * 1.5;
};

// Calculate a simple moving average of body sizes for context
export const getAvgBodySize = (candles: Candle[], index: number, period = 10) => {
  if (index < period) return bodySize(candles[index]!);
  let sum = 0;
  for (let i = index - period; i < index; i++) {
    sum += bodySize(candles[i]!);
  }
  return sum / period;
};
