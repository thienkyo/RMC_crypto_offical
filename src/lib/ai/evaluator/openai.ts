/**
 * OpenAI (ChatGPT) Order Evaluator client.
 * Server-side only. Requires OPENAI_API_KEY in environment.
 */

import type { EvaluationPromptPayload, OrderEvaluationResult } from './types';
import { ORDER_EVALUATOR_SYSTEM_PROMPT, buildEvaluationUserPrompt } from './prompt';
import { parseAndValidateEvaluationResponse } from './claude';
import { getAiKey, getAiModel, getAiMaxTokens } from '@/lib/db/aiSettings';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAiChoice {
  message?: {
    content?: string;
  };
}

interface OpenAiResponse {
  choices?: OpenAiChoice[];
  error?: { message: string; code?: string };
}

export async function evaluateWithOpenAi(
  payload: EvaluationPromptPayload,
): Promise<OrderEvaluationResult> {
  const apiKey = await getAiKey('chatgpt');
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured. Set it in Settings or OPENAI_API_KEY in .env.local.');
  }

  const model = await getAiModel('chatgpt');
  const userPrompt = buildEvaluationUserPrompt(payload);
  const maxTokens = await getAiMaxTokens();

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [

        { role: 'system', content: ORDER_EVALUATOR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as OpenAiResponse;
  if (data.error) {
    throw new Error(`OpenAI error: ${data.error.message}`);
  }

  const text = data.choices?.[0]?.message?.content ?? '';
  return parseAndValidateEvaluationResponse(text, 'chatgpt', model);
}
