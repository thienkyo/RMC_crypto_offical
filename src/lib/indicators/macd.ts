import type { Candle } from '@/types/market';
import type { Indicator, IndicatorResult } from './types';

interface MacdParams { fast: number; slow: number; signal: number; trendEma: number; [key: string]: number }

function emaArray(values: number[], period: number): number[] {
  const k   = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = 0; i < period - 1; i++) out.push(NaN);
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export const macd: Indicator<MacdParams> = {
  id: 'macd',
  name: 'MACD',
  description: `The "Strategy Signal" Series calculates all complex rules internally.
Normally, a MACD strategy requires building complex rules manually:
1. MACD Line must cross above/below Signal Line AND
2. MACD Line must be below/above 0 AND
3. Price must be above/below the Trend EMA.

Instead of building these rules, the "Strategy Signal" series acts like a switch that outputs:
• 0 = Nothing is happening.
• 1 = All conditions for a LONG (Buy) are perfectly met.
• -1 = All conditions for a SHORT (Sell) are perfectly met.

Strategy Setup Reminder:
• For LONG Entry: Strategy Signal > 0
• For SHORT Entry: Strategy Signal < 0

Note: Selecting MACD Line, Signal, or Histogram ignores the Trend EMA and functions exactly like a standard MACD.`,
  defaultParams: { fast: 12, slow: 26, signal: 9, trendEma: 200 },
  paramsMeta: {
    fast:     { label: 'Fast Period',   min: 2,  max: 100, step: 1 },
    slow:     { label: 'Slow Period',   min: 2,  max: 200, step: 1 },
    signal:   { label: 'Signal Period', min: 2,  max: 50,  step: 1 },
    trendEma: { label: 'Trend EMA',     min: 10, max: 500, step: 1 },
  },

  compute(candles: Candle[], params: MacdParams): IndicatorResult {
    const p = { ...macd.defaultParams, ...params };
    const fast = p.fast ?? macd.defaultParams.fast;
    const slow = p.slow ?? macd.defaultParams.slow;
    const signal = p.signal ?? macd.defaultParams.signal;
    const trendEma = p.trendEma ?? macd.defaultParams.trendEma;

    // Need at least enough candles for the trend EMA
    const minRequired = Math.max(slow + signal, trendEma);
    if (candles.length < minRequired) return [];

    const closes   = candles.map((c) => c.close);
    const fastEma  = emaArray(closes, fast);
    const slowEma  = emaArray(closes, slow);
    const trendEmaArr = emaArray(closes, trendEma);
    
    const macdLine = fastEma.map((f, i) => f - slowEma[i]!);

    const macdValid  = macdLine.slice(slow - 1);
    const signalArr  = emaArray(macdValid, signal);
    
    // Create full-length arrays for easier indexing
    const fullMacd = [...Array(slow - 1).fill(NaN), ...macdValid];
    const fullSignal = [...Array(slow - 1).fill(NaN), ...signalArr];
    const fullHist = fullMacd.map((m, i) => m - fullSignal[i]!);
    
    const strategySignals: number[] = new Array(candles.length).fill(0);
    const times = candles.map((c) => c.openTime);
    
    for (let i = minRequired; i < candles.length; i++) {
        const prevMacd = fullMacd[i - 1]!;
        const currMacd = fullMacd[i]!;
        const prevSig = fullSignal[i - 1]!;
        const currSig = fullSignal[i]!;
        
        const isBullishCross = prevMacd < prevSig && currMacd > currSig;
        const isBearishCross = prevMacd > prevSig && currMacd < currSig;
        
        const close = closes[i]!;
        const emaVal = trendEmaArr[i]!;
        
        let sig = 0;
        // Phase 2 logic: 
        // Long: Bullish cross AND MACD <= 0 AND Close > Trend EMA
        if (isBullishCross && currMacd <= 0 && close > emaVal) {
            sig = 1;
        } 
        // Short: Bearish cross AND MACD >= 0 AND Close < Trend EMA
        else if (isBearishCross && currMacd >= 0 && close < emaVal) {
            sig = -1;
        }
        strategySignals[i] = sig;
    }

    const startIdx = minRequired;

    return [
      {
        id: 'macd_line', name: 'MACD Line',
        data: fullMacd.slice(startIdx).map((v, i) => ({ time: times[i + startIdx]!, value: v })),
        panel: 'sub', color: '#3b82f6', lineWidth: 1.5, seriesType: 'line',
      },
      {
        id: 'macd_signal', name: 'Signal',
        data: fullSignal.slice(startIdx).map((v, i) => ({ time: times[i + startIdx]!, value: v })),
        panel: 'sub', color: '#f59e0b', lineWidth: 1, seriesType: 'line',
      },
      {
        id: 'macd_hist', name: 'Histogram',
        data: fullHist.slice(startIdx).map((v, i) => ({
          time: times[i + startIdx]!, value: v,
          color: v >= 0 ? '#10b981' : '#ef4444',
        })),
        panel: 'sub', color: '#10b981', lineWidth: 1, seriesType: 'histogram',
      },
      {
        id: 'macd_strategy', name: 'Strategy Signal',
        data: strategySignals.slice(startIdx).map((v, i) => ({
          time: times[i + startIdx]!, value: v,
        })),
        panel: 'sub', color: '#8b5cf6', lineWidth: 2, seriesType: 'line',
        markers: strategySignals.slice(startIdx).map((v, i) => {
            if (v === 1) return { time: times[i + startIdx]!, position: 'belowBar', color: '#10b981', shape: 'arrowUp', text: 'LONG' };
            if (v === -1) return { time: times[i + startIdx]!, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'SHORT' };
            return null;
        }).filter(Boolean) as any
      }
    ];
  },
};
