/**
 * POST /api/ai/evaluate-order
 *
 * Evaluates a proposed setup (long/short, entry, SL, TP) using
 * real-time candles, 37+ technical indicators, and multi-channel sentiment.
 *
 * Supported providers: 'claude' | 'chatgpt' | 'gemini' | 'ensemble'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluateOrder } from '@/lib/ai/evaluator/gateway';
import type { OrderEvaluationRequest, EvaluatorProvider } from '@/lib/ai/evaluator/types';
import { fetchLatestCandlesCached } from '@/lib/db/candles';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Partial<OrderEvaluationRequest>;
  try {
    body = (await req.json()) as Partial<OrderEvaluationRequest>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const { symbol, timeframe, direction, entryPrice, candleTime, stopLossPct, takeProfitPct, provider, customNotes } = body;

  if (!symbol || !timeframe || !direction || !entryPrice || !candleTime) {
    return NextResponse.json(
      { error: 'Missing required fields: symbol, timeframe, direction, entryPrice, candleTime.' },
      { status: 400 },
    );
  }

  if (direction !== 'long' && direction !== 'short') {
    return NextResponse.json(
      { error: 'direction must be either "long" or "short".' },
      { status: 400 },
    );
  }

  const validProviders: EvaluatorProvider[] = ['claude', 'chatgpt', 'gemini', 'ensemble'];
  const selectedProvider: EvaluatorProvider = provider && validProviders.includes(provider)
    ? provider
    : 'gemini';

  // Fetch recent candles for technical analysis
  let candles = [];
  try {
    candles = await fetchLatestCandlesCached(symbol, timeframe, 300);
  } catch (err) {
    console.error('[evaluate-order] Failed to fetch candles:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve market candles for evaluation.' },
      { status: 500 },
    );
  }

  try {
    const evaluation = await evaluateOrder(
      {
        symbol,
        timeframe,
        direction,
        entryPrice: Number(entryPrice),
        stopLossPct: stopLossPct !== undefined ? Number(stopLossPct) : undefined,
        takeProfitPct: takeProfitPct !== undefined ? Number(takeProfitPct) : undefined,
        candleTime: Number(candleTime),
        provider: selectedProvider,
        customNotes,
      },
      candles,
    );

    return NextResponse.json({ success: true, evaluation });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[evaluate-order] Evaluation error:', message);
    return NextResponse.json(
      { error: `Evaluation failed: ${message}` },
      { status: 502 },
    );
  }
}
