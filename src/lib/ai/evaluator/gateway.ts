/**
 * Multi-LLM Gateway and Ensemble Evaluator.
 *
 * Coordinates provider dispatch, multi-model consensus, error recovery,
 * and database caching (ai_order_evaluations).
 */

import { db } from '@/lib/db/client';
import type {
  OrderEvaluationRequest,
  OrderEvaluationResult,
  EvaluationPromptPayload,
  EvaluatorProvider,
  EvaluationStatus,
  EnsembleVote,
} from './types';
import { buildEvaluationContext } from './contextBuilder';
import { evaluateWithClaude } from './claude';
import { evaluateWithOpenAi } from './openai';
import { evaluateWithGemini } from './gemini';
import type { Candle } from '@/types/market';

export async function evaluateOrder(
  request: OrderEvaluationRequest,
  candles: Candle[],
): Promise<OrderEvaluationResult> {
  const provider: EvaluatorProvider = request.provider || 'gemini';
  const candleTimeIso = new Date(request.candleTime).toISOString();

  // ── 1. Check PostgreSQL Cache ──────────────────────────────────────────────
  try {
    const cached = await db.query<{
      evaluation: OrderEvaluationResult;
      created_at: Date;
    }>(
      `SELECT evaluation, created_at
       FROM ai_order_evaluations
       WHERE symbol = $1
         AND timeframe = $2
         AND direction = $3
         AND candle_time = $4
         AND model_provider = $5
       LIMIT 1`,
      [request.symbol, request.timeframe, request.direction, candleTimeIso, provider],
    );

    if (cached.rows.length > 0) {
      const row = cached.rows[0]!;
      return {
        ...row.evaluation,
        fromCache: true,
      };
    }
  } catch (err) {
    console.error('[evaluator/gateway] Cache lookup failed:', err);
  }

  // ── 2. Build Payload Context ───────────────────────────────────────────────
  const payload: EvaluationPromptPayload = await buildEvaluationContext({
    symbol: request.symbol,
    timeframe: request.timeframe,
    direction: request.direction,
    entryPrice: request.entryPrice,
    stopLossPct: request.stopLossPct,
    takeProfitPct: request.takeProfitPct,
    candles,
    customNotes: request.customNotes,
  });

  // ── 3. Execute Model Evaluation ────────────────────────────────────────────
  let result: OrderEvaluationResult;

  if (provider === 'ensemble') {
    result = await runEnsembleEvaluation(payload);
  } else if (provider === 'claude') {
    result = await evaluateWithClaude(payload);
  } else if (provider === 'chatgpt') {
    result = await evaluateWithOpenAi(payload);
  } else {
    result = await evaluateWithGemini(payload);
  }

  // ── 4. Persist to Cache ────────────────────────────────────────────────────
  try {
    await db.query(
      `INSERT INTO ai_order_evaluations
         (symbol, timeframe, direction, candle_time, model_provider, status, evaluation)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (symbol, timeframe, direction, candle_time, model_provider)
       DO UPDATE SET
         status = EXCLUDED.status,
         evaluation = EXCLUDED.evaluation,
         created_at = NOW()`,
      [
        request.symbol,
        request.timeframe,
        request.direction,
        candleTimeIso,
        provider,
        result.status,
        JSON.stringify(result),
      ],
    );
  } catch (err) {
    console.error('[evaluator/gateway] Cache insert failed:', err);
  }

  return {
    ...result,
    fromCache: false,
  };
}

/**
 * Runs available models in parallel and synthesizes an ensemble verdict.
 */
async function runEnsembleEvaluation(
  payload: EvaluationPromptPayload,
): Promise<OrderEvaluationResult> {
  const { getAiKey } = await import('@/lib/db/aiSettings');
  const [claudeKey, openaiKey, geminiKey] = await Promise.all([
    getAiKey('claude'),
    getAiKey('chatgpt'),
    getAiKey('gemini'),
  ]);

  const providersToRun: Array<{
    name: 'claude' | 'chatgpt' | 'gemini';
    runner: () => Promise<OrderEvaluationResult>;
  }> = [];

  if (claudeKey) {
    providersToRun.push({ name: 'claude', runner: () => evaluateWithClaude(payload) });
  }
  if (openaiKey) {
    providersToRun.push({ name: 'chatgpt', runner: () => evaluateWithOpenAi(payload) });
  }
  if (geminiKey) {
    providersToRun.push({ name: 'gemini', runner: () => evaluateWithGemini(payload) });
  }

  if (providersToRun.length === 0) {
    throw new Error('No AI provider API keys configured for ensemble evaluation.');
  }

  const settled = await Promise.allSettled(providersToRun.map((p) => p.runner()));
  const successfulResults: Array<{ name: string; result: OrderEvaluationResult }> = [];

  settled.forEach((res, idx) => {
    const provName = providersToRun[idx]!.name;
    if (res.status === 'fulfilled') {
      successfulResults.push({ name: provName, result: res.value });
    } else {
      console.warn(`[ensemble] ${provName} failed:`, res.reason);
    }
  });

  if (successfulResults.length === 0) {
    throw new Error('All AI providers in ensemble failed to respond.');
  }

  // Tally votes
  const votes: Record<string, EnsembleVote> = {};
  let passCount = 0;
  let caveatCount = 0;
  let rejectCount = 0;
  let totalTechScore = 0;
  let totalSentScore = 0;

  for (const { name, result } of successfulResults) {
    votes[name] = {
      status: result.status,
      reason: result.summary,
    };
    if (result.status === 'PASS') passCount++;
    else if (result.status === 'CAVEAT') caveatCount++;
    else if (result.status === 'REJECT') rejectCount++;

    totalTechScore += result.metrics.technicalScore;
    totalSentScore += result.metrics.sentimentScore;
  }

  // Consensus logic
  let finalStatus: EvaluationStatus;
  if (rejectCount >= 2 || (rejectCount === 1 && successfulResults.length === 1)) {
    finalStatus = 'REJECT';
  } else if (rejectCount === 1) {
    // Single rejection flags caveat
    finalStatus = 'CAVEAT';
  } else if (passCount === successfulResults.length) {
    finalStatus = 'PASS';
  } else {
    finalStatus = 'CAVEAT';
  }

  const primary = successfulResults[0]!.result;
  const voteSummary = Object.entries(votes)
    .map(([k, v]) => `${k.toUpperCase()}: ${v.status}`)
    .join(', ');

  return {
    status: finalStatus,
    confidence: passCount === successfulResults.length || rejectCount === successfulResults.length ? 'high' : 'medium',
    summary: `Ensemble consensus [${voteSummary}]: ${finalStatus}. ${primary.summary}`,
    reasons: {
      technical: primary.reasons.technical,
      sentiment: primary.reasons.sentiment,
      primaryRisk: primary.reasons.primaryRisk,
    },
    metrics: {
      technicalScore: Math.round(totalTechScore / successfulResults.length),
      sentimentScore: Math.round(totalSentScore / successfulResults.length),
    },
    model: {
      provider: 'ensemble',
      modelName: `Ensemble (${successfulResults.map((r) => r.name).join('+')})`,
      ensembleVotes: votes,
    },
    evaluatedAt: new Date().toISOString(),
  };
}
