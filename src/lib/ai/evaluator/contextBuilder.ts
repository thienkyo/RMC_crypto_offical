/**
 * Context builder for the Order Decision Evaluator.
 *
 * Synthesizes quantitative indicators, price action patterns, and
 * multi-source news/social sentiment into a token-efficient payload (~1.2k tokens).
 */

import type { Candle } from '@/types/market';
import type {
  EvaluationPromptPayload,
  TechnicalSnapshot,
  SentimentSnapshot,
} from './types';
import { rsi } from '@/lib/indicators/rsi';
import { macd } from '@/lib/indicators/macd';
import { ema } from '@/lib/indicators/ema';
import { bollinger } from '@/lib/indicators/bollinger';
import * as patterns from '@/lib/patterns';
import { getArticlesForSymbol } from '@/lib/db/news';

export interface BuildContextParams {
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  candles: Candle[];
  customNotes?: string;
}

export async function buildEvaluationContext(params: BuildContextParams): Promise<EvaluationPromptPayload> {
  const { symbol, timeframe, direction, entryPrice, stopLossPct, takeProfitPct, candles, customNotes } = params;

  // ── 1. Calculate Target Stop Loss & Take Profit Prices ──────────────────────
  let stopLossPrice: number | undefined;
  let takeProfitPrice: number | undefined;

  if (stopLossPct && stopLossPct > 0) {
    stopLossPrice = direction === 'long'
      ? entryPrice * (1 - stopLossPct / 100)
      : entryPrice * (1 + stopLossPct / 100);
  }

  if (takeProfitPct && takeProfitPct > 0) {
    takeProfitPrice = direction === 'long'
      ? entryPrice * (1 + takeProfitPct / 100)
      : entryPrice * (1 - takeProfitPct / 100);
  }

  // ── 2. Build Technical Snapshot ───────────────────────────────────────────
  const technical = buildTechnicalSnapshot(candles);

  // ── 3. Build Sentiment Snapshot from Database ─────────────────────────────
  const sentiment = await buildSentimentSnapshot(symbol);

  return {
    symbol,
    timeframe,
    direction,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    technical,
    sentiment,
    customNotes,
  };
}

function buildTechnicalSnapshot(candles: Candle[]): TechnicalSnapshot {
  if (!candles || candles.length === 0) {
    return {
      currentPrice: 0,
      trendEma: 'Insufficient candle data',
      activePatterns: [],
      recentCandlesSummary: 'No candle data available',
    };
  }

  const latestCandle = candles[candles.length - 1]!;
  const currentPrice = latestCandle.close;

  // 24h change approx (assuming enough candles)
  let priceChange24hPct: number | undefined;
  if (candles.length > 24) {
    const prior = candles[Math.max(0, candles.length - 25)]!.close;
    if (prior > 0) {
      priceChange24hPct = ((currentPrice - prior) / prior) * 100;
    }
  }

  // ── EMAs (20, 50, 200) ────────────────────────────────────────────────────
  const ema20Res = ema.compute(candles, { period: 20 });
  const ema50Res = ema.compute(candles, { period: 50 });
  const ema200Res = ema.compute(candles, { period: 200 });

  const e20 = ema20Res[0]?.data?.slice(-1)[0]?.value;
  const e50 = ema50Res[0]?.data?.slice(-1)[0]?.value;
  const e200 = ema200Res[0]?.data?.slice(-1)[0]?.value;

  let trendEma = 'EMAs calculating';
  if (e20 && e50 && e200) {
    if (currentPrice > e20 && e20 > e50 && e50 > e200) {
      trendEma = `Strong Bullish Alignment (Price > EMA20[${e20.toFixed(2)}] > EMA50[${e50.toFixed(2)}] > EMA200[${e200.toFixed(2)}])`;
    } else if (currentPrice < e20 && e20 < e50 && e50 < e200) {
      trendEma = `Strong Bearish Alignment (Price < EMA20[${e20.toFixed(2)}] < EMA50[${e50.toFixed(2)}] < EMA200[${e200.toFixed(2)}])`;
    } else {
      trendEma = `Mixed / Consolidating (Price: ${currentPrice.toFixed(2)}, EMA20: ${e20.toFixed(2)}, EMA50: ${e50.toFixed(2)}, EMA200: ${e200.toFixed(2)})`;
    }
  } else if (e20) {
    trendEma = currentPrice > e20 ? `Above EMA20 (${e20.toFixed(2)})` : `Below EMA20 (${e20.toFixed(2)})`;
  }

  // ── RSI(14) ───────────────────────────────────────────────────────────────
  const rsiRes = rsi.compute(candles, { period: 14, emaPeriod: 10 });
  const rsiPoint = rsiRes[0]?.data?.slice(-1)[0];
  const rsi14 = rsiPoint?.value;
  let rsiDivergence: string | undefined;
  if (rsi14 !== undefined) {
    if (rsi14 >= 70) rsiDivergence = 'Overbought (>70)';
    else if (rsi14 <= 30) rsiDivergence = 'Oversold (<30)';
    else rsiDivergence = 'Neutral Momentum (30-70)';
  }

  // ── MACD ──────────────────────────────────────────────────────────────────
  const macdRes = macd.compute(candles, { fast: 12, slow: 26, signal: 9, trendEma: 200 });
  const macdLine = macdRes.find((r) => r.id === 'macd_line')?.data?.slice(-1)[0]?.value;
  const macdSignal = macdRes.find((r) => r.id === 'macd_signal')?.data?.slice(-1)[0]?.value;
  const macdHist = macdRes.find((r) => r.id === 'macd_hist')?.data?.slice(-1)[0]?.value;

  let macdSummary: TechnicalSnapshot['macd'];
  if (macdLine !== undefined && macdSignal !== undefined && macdHist !== undefined) {
    const status = macdHist > 0
      ? (macdLine > macdSignal ? 'Bullish expansion above signal' : 'Weakening bullish')
      : (macdLine < macdSignal ? 'Bearish expansion below signal' : 'Weakening bearish');
    macdSummary = {
      line: macdLine,
      signal: macdSignal,
      histogram: macdHist,
      status,
    };
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  const bbRes = bollinger.compute(candles, { period: 20, stdDevMult: 2 });
  const bbMid = bbRes.find((r) => r.id === 'bollinger_mid')?.data?.slice(-1)[0]?.value;
  const bbUp = bbRes.find((r) => r.id === 'bollinger_up')?.data?.slice(-1)[0]?.value;
  const bbLow = bbRes.find((r) => r.id === 'bollinger_low')?.data?.slice(-1)[0]?.value;

  let bollingerSummary: TechnicalSnapshot['bollinger'];
  if (bbMid && bbUp && bbLow && (bbUp - bbLow) > 0) {
    const percentB = (currentPrice - bbLow) / (bbUp - bbLow);
    const bandwidth = (bbUp - bbLow) / bbMid;
    const status = percentB > 1.0 ? 'Piercing Upper Band (Overbought)'
      : percentB < 0.0 ? 'Piercing Lower Band (Oversold)'
      : percentB > 0.5 ? 'Upper Half (Bullish Bias)'
      : 'Lower Half (Bearish Bias)';
    bollingerSummary = { percentB, bandwidth, status };
  }

  // ── Price Action Patterns (last 3 bars) ───────────────────────────────────
  const activePatterns: string[] = [];
  const pList = [
    { name: 'Bullish Engulfing', ind: patterns.bullishEngulfing },
    { name: 'Bearish Engulfing', ind: patterns.bearishEngulfing },
    { name: 'Hammer', ind: patterns.hammer },
    { name: 'Shooting Star', ind: patterns.shootingStar },
    { name: 'Bullish FVG', ind: patterns.bullishFVG },
    { name: 'Bearish FVG', ind: patterns.bearishFVG },
    { name: 'Bullish Liquidity Sweep', ind: patterns.bullishLiquiditySweep },
    { name: 'Bearish Liquidity Sweep', ind: patterns.bearishLiquiditySweep },
    { name: 'Three White Soldiers', ind: patterns.threeWhiteSoldiers },
    { name: 'Three Crows', ind: patterns.identicalThreeCrows },
  ];

  for (const p of pList) {
    try {
      const res = p.ind.compute(candles, {});
      const hit = res[0]?.data?.slice(-3).some((pt) => pt.value && pt.value > 0);
      if (hit) activePatterns.push(p.name);
    } catch {
      // Non-fatal
    }
  }

  // ── Recent Candles Summary ────────────────────────────────────────────────
  const lastBars = candles.slice(-5);
  const recentCandlesSummary = lastBars.map((c, i) => {
    const isGreen = c.close >= c.open;
    const bodyPct = Math.abs(((c.close - c.open) / c.open) * 100).toFixed(2);
    return `Bar -${lastBars.length - 1 - i}: ${isGreen ? 'GREEN' : 'RED'} (${bodyPct}%), H: ${c.high}, L: ${c.low}, C: ${c.close}`;
  }).join(' | ');

  return {
    currentPrice,
    priceChange24hPct,
    trendEma,
    rsi14,
    rsiDivergence,
    macd: macdSummary,
    bollinger: bollingerSummary,
    activePatterns,
    recentCandlesSummary,
  };
}

async function buildSentimentSnapshot(symbol: string): Promise<SentimentSnapshot> {
  try {
    // Look back up to 48 hours for relevant news
    const articles = await getArticlesForSymbol(symbol, 20);

    if (!articles || articles.length === 0) {
      return {
        averageScore: 0,
        overallLabel: 'neutral',
        totalArticlesSampled: 0,
        recentHeadlines: [],
      };
    }

    let scoreSum = 0;
    let scoreCount = 0;

    const recentHeadlines = articles.slice(0, 10).map((a) => {
      if (a.sentimentScore !== null && a.sentimentScore !== undefined) {
        scoreSum += a.sentimentScore;
        scoreCount++;
      }
      return {
        source: a.source,
        title: a.title,
        publishedAt: a.publishedAt,
        sentimentScore: a.sentimentScore ?? undefined,
      };
    });

    const averageScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
    const overallLabel: SentimentSnapshot['overallLabel'] =
      averageScore > 0.15 ? 'bullish' : averageScore < -0.15 ? 'bearish' : 'neutral';

    return {
      averageScore,
      overallLabel,
      totalArticlesSampled: articles.length,
      recentHeadlines,
    };
  } catch (err) {
    console.warn('[contextBuilder] Error fetching news sentiment:', err);
    return {
      averageScore: 0,
      overallLabel: 'neutral',
      totalArticlesSampled: 0,
      recentHeadlines: [],
    };
  }
}
