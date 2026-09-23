import { describe, it, expect } from 'vitest';
import { parseAndValidateEvaluationResponse } from './claude';
import { buildEvaluationUserPrompt, ORDER_EVALUATOR_SYSTEM_PROMPT } from './prompt';
import type { EvaluationPromptPayload } from './types';

describe('AI Order Decision Evaluator', () => {
  it('parses valid JSON response with PASS status', () => {
    const raw = JSON.stringify({
      status: 'PASS',
      confidence: 'high',
      summary: 'High probability long setup with strong trend alignment and positive sentiment.',
      reasons: {
        technical: 'RSI bounced out of oversold, price above 20 EMA, MACD bullish crossover.',
        sentiment: 'Strong spot ETF accumulation reports on Telegram and financial news.',
        primaryRisk: 'Support invalidation below $68,500.',
      },
      metrics: {
        technicalScore: 88,
        sentimentScore: 65,
      },
    });

    const parsed = parseAndValidateEvaluationResponse(raw, 'claude', 'claude-3-5-sonnet');
    expect(parsed.status).toBe('PASS');
    expect(parsed.confidence).toBe('high');
    expect(parsed.metrics.technicalScore).toBe(88);
    expect(parsed.reasons.technical).toContain('RSI bounced');
    expect(parsed.model.provider).toBe('claude');
  });

  it('parses markdown-fenced JSON responses correctly', () => {
    const raw = `\`\`\`json
{
  "status": "CAVEAT",
  "confidence": "medium",
  "summary": "Technicals bullish but heading directly into overhead resistance.",
  "reasons": {
    "technical": "Approaching 200 EMA resistance band.",
    "sentiment": "Neutral news flow across X and Telegram.",
    "primaryRisk": "Failure to break resistance."
  },
  "metrics": {
    "technicalScore": 55,
    "sentimentScore": 5
  }
}
\`\`\``;

    const parsed = parseAndValidateEvaluationResponse(raw, 'chatgpt', 'gpt-4o');
    expect(parsed.status).toBe('CAVEAT');
    expect(parsed.metrics.technicalScore).toBe(55);
  });

  it('normalizes invalid status values to CAVEAT', () => {
    const raw = JSON.stringify({
      status: 'MAYBE',
      confidence: 'low',
      summary: 'Uncertain conditions.',
      reasons: { technical: '', sentiment: '', primaryRisk: '' },
      metrics: { technicalScore: 40, sentimentScore: 0 },
    });

    const parsed = parseAndValidateEvaluationResponse(raw, 'gemini', 'gemini-2.0-flash');
    expect(parsed.status).toBe('CAVEAT');
  });

  it('builds comprehensive evaluation user prompt', () => {
    const payload: EvaluationPromptPayload = {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      direction: 'long',
      entryPrice: 65000,
      stopLossPrice: 63000,
      takeProfitPrice: 69000,
      technical: {
        currentPrice: 65000,
        trendEma: 'Price > EMA20 > EMA50 > EMA200',
        rsi14: 42.5,
        rsiDivergence: 'Neutral Momentum',
        activePatterns: ['Bullish Engulfing'],
        recentCandlesSummary: 'Bar -0: GREEN, Bar -1: GREEN',
      },
      sentiment: {
        averageScore: 0.45,
        overallLabel: 'bullish',
        totalArticlesSampled: 8,
        recentHeadlines: [
          { source: 'telegram', title: 'Whale alert moves 5000 BTC off exchange', publishedAt: '2026-05-28' },
          { source: 'coindesk', title: 'Institutional inflows surge this week', publishedAt: '2026-05-28' },
        ],
      },
    };

    const prompt = buildEvaluationUserPrompt(payload);
    expect(prompt).toContain('BTCUSDT');
    expect(prompt).toContain('LONG');
    expect(prompt).toContain('EMA20');
    expect(prompt).toContain('Whale alert');
    expect(ORDER_EVALUATOR_SYSTEM_PROMPT).toContain('"PASS" | "CAVEAT" | "REJECT"');
  });

  it('exposes the latest 2025/2026 models for all 3 AI providers', async () => {
    const { LATEST_MODELS } = await import('./types');
    expect(LATEST_MODELS.claude.default).toBe('claude-opus-5-1');
    expect(LATEST_MODELS.chatgpt.default).toBe('gpt-5.1');
    expect(LATEST_MODELS.gemini.default).toBe('gemini-3.8-flash');

    expect(LATEST_MODELS.claude.options.some((o) => o.id === 'claude-opus-5-1')).toBe(true);
    expect(LATEST_MODELS.claude.options.some((o) => o.id.includes('claude-3-7-sonnet'))).toBe(true);
    expect(LATEST_MODELS.chatgpt.options.some((o) => o.id === 'gpt-5.1')).toBe(true);
    expect(LATEST_MODELS.chatgpt.options.some((o) => o.id === 'gpt-6-astra')).toBe(true);
    expect(LATEST_MODELS.gemini.options.some((o) => o.id === 'gemini-3.8-flash')).toBe(true);
    expect(LATEST_MODELS.gemini.options.some((o) => o.id === 'gemini-3.8-live')).toBe(true);
  });

  it('converts dollar amounts to max output tokens intuitively', async () => {
    const { costToMaxTokens, maxTokensToCost } = await import('./types');

    // $0.010 -> 1,000 tokens
    expect(costToMaxTokens(0.01)).toBe(1000);
    // $0.005 -> 500 tokens
    expect(costToMaxTokens(0.005)).toBe(500);
    // $0.020 -> 2,000 tokens
    expect(costToMaxTokens(0.02)).toBe(2000);

    // Clamps to min/max safety limits (256 - 8192)
    expect(costToMaxTokens(0.001)).toBe(256);
    expect(costToMaxTokens(0.25)).toBe(8192);

    // Converts back
    expect(maxTokensToCost(1000)).toBe(0.01);
    expect(maxTokensToCost(2000)).toBe(0.02);
  });
});
