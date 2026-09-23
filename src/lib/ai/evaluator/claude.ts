/**
 * Claude (Anthropic) Order Evaluator client.
 * Server-side only. Requires ANTHROPIC_API_KEY in environment.
 */

import type { EvaluationPromptPayload, OrderEvaluationResult, EvaluationStatus } from './types';
import { ORDER_EVALUATOR_SYSTEM_PROMPT, buildEvaluationUserPrompt } from './prompt';
import { getAiKey, getAiModel, getAiMaxTokens } from '@/lib/db/aiSettings';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: { type: string; message: string };
}

export async function evaluateWithClaude(
  payload: EvaluationPromptPayload,
): Promise<OrderEvaluationResult> {
  const apiKey = await getAiKey('claude');
  if (!apiKey) {
    throw new Error('Claude API key is not configured. Set it in Settings or ANTHROPIC_API_KEY in .env.local.');
  }

  const model = await getAiModel('claude');
  const userPrompt = buildEvaluationUserPrompt(payload);
  const maxTokens = await getAiMaxTokens();

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.1,
      system: ORDER_EVALUATOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });


  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as AnthropicResponse;
  if (data.error) {
    throw new Error(`Claude error: ${data.error.message}`);
  }

  const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
  return parseAndValidateEvaluationResponse(text, 'claude', model);
}

export function parseAndValidateEvaluationResponse(
  rawText: string,
  provider: 'claude' | 'chatgpt' | 'gemini',
  modelName: string,
): OrderEvaluationResult {
  if (!rawText) {
    throw new Error(`${provider} returned an empty response.`);
  }

  // Extract JSON if wrapped in markdown codeblocks
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`${provider} response was not valid JSON: ${rawText.slice(0, 200)}`);
  }

  const validStatuses: EvaluationStatus[] = ['PASS', 'CAVEAT', 'REJECT'];
  let status = typeof parsed['status'] === 'string' ? (parsed['status'].toUpperCase() as EvaluationStatus) : 'CAVEAT';
  if (!validStatuses.includes(status)) {
    status = 'CAVEAT';
  }

  const reasonsRaw = (parsed['reasons'] as Record<string, unknown>) ?? {};
  const metricsRaw = (parsed['metrics'] as Record<string, unknown>) ?? {};

  const confidence = ['high', 'medium', 'low'].includes(String(parsed['confidence']).toLowerCase())
    ? (String(parsed['confidence']).toLowerCase() as 'high' | 'medium' | 'low')
    : 'medium';

  return {
    status,
    confidence,
    summary: typeof parsed['summary'] === 'string' && parsed['summary'].trim().length > 0
      ? parsed['summary'].trim()
      : `Evaluation completed with ${status} verdict.`,
    reasons: {
      technical: String(reasonsRaw['technical'] ?? 'Technical indicators analyzed.'),
      sentiment: String(reasonsRaw['sentiment'] ?? 'Sentiment analyzed.'),
      primaryRisk: String(reasonsRaw['primaryRisk'] ?? 'Standard volatility and market execution risk.'),
    },
    metrics: {
      technicalScore: typeof metricsRaw['technicalScore'] === 'number' ? metricsRaw['technicalScore'] : 50,
      sentimentScore: typeof metricsRaw['sentimentScore'] === 'number' ? metricsRaw['sentimentScore'] : 0,
    },
    model: {
      provider,
      modelName,
    },
    evaluatedAt: new Date().toISOString(),
  };
}
