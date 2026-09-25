/**
 * Google Gemini Order Evaluator client.
 * Server-side only. Requires GEMINI_API_KEY in environment.
 */

import type { EvaluationPromptPayload, OrderEvaluationResult } from './types';
import { ORDER_EVALUATOR_SYSTEM_PROMPT, buildEvaluationUserPrompt } from './prompt';
import { parseAndValidateEvaluationResponse } from './claude';
import { getAiKey, getAiModel, getAiMaxTokens } from '@/lib/db/aiSettings';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { code: number; message: string };
}

export async function evaluateWithGemini(
  payload: EvaluationPromptPayload,
): Promise<OrderEvaluationResult> {
  const apiKey = await getAiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Set it in Settings or GEMINI_API_KEY in .env.local.');
  }

  const configuredModel = await getAiModel('gemini');
  const maxTokens = await getAiMaxTokens();
  const userPrompt = buildEvaluationUserPrompt(payload);

  const body = {
    system_instruction: {
      parts: [{ text: ORDER_EVALUATOR_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: Math.max(maxTokens, 4096),
    },
  };

  const modelsToTry = [configuredModel];
  if (configuredModel !== 'gemini-2.5-flash') {
    modelsToTry.push('gemini-2.5-flash');
  }

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        if ((res.status === 503 || res.status === 404) && model !== 'gemini-2.5-flash') {
          console.warn(`[Gemini Evaluator] Model ${model} returned ${res.status}. Falling back to gemini-2.5-flash...`);
          continue;
        }
        throw new Error(`Gemini API error ${res.status}: ${errorText}`);
      }

      const data = (await res.json()) as GeminiResponse;
      if (data.error) {
        throw new Error(`Gemini error ${data.error.code}: ${data.error.message}`);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return parseAndValidateEvaluationResponse(text, 'gemini', model);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (model !== 'gemini-2.5-flash') {
        console.warn(`[Gemini Evaluator] Call with ${model} failed, trying fallback:`, lastError.message);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Gemini evaluation failed on all models.');
}
