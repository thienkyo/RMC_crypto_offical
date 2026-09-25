/**
 * Gemini Vision client — server-side only.
 *
 * Uses the Gemini REST API directly (no SDK) to avoid extra dependencies.
 * Model: dynamically loaded from Settings (defaults to gemini-3.8-flash).
 * Automatic fallback to gemini-2.5-flash if primary model experiences 503 spikes.
 *
 * Never import this file from client components.
 */

import type { ChartAnalysis } from './types';
import { CHART_ANALYSIS_SYSTEM_PROMPT, buildChartPrompt } from './prompts';
import { getAiKey, getAiModel } from '@/lib/db/aiSettings';

export const GEMINI_MODEL_NAME = 'gemini-3.8-flash';

/** Gemini REST API response shape (minimal — only fields we use). */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  error?: { code: number; message: string; status: string };
}

export interface AnalyzeChartResult {
  analysis: ChartAnalysis;
  model: string;
}

/**
 * Send a chart image to Gemini and return a parsed ChartAnalysis along with the model used.
 *
 * @param imageBase64 - Raw base64 PNG (no data-URL prefix).
 * @param symbol      - e.g. "BTCUSDT"
 * @param timeframe   - e.g. "1h"
 * @throws Error if the API call fails or the response cannot be parsed as ChartAnalysis.
 */
export async function analyzeChartWithGemini(
  imageBase64: string,
  symbol:      string,
  timeframe:   string,
): Promise<AnalyzeChartResult> {
  const apiKey = (await getAiKey('gemini')) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Set it in Settings or GEMINI_API_KEY in .env.local.');
  }

  const primaryModel = (await getAiModel('gemini')) || GEMINI_MODEL_NAME;
  const modelsToTry = [primaryModel];
  if (primaryModel !== 'gemini-2.5-flash') {
    modelsToTry.push('gemini-2.5-flash');
  }

  const body = {
    system_instruction: {
      parts: [{ text: CHART_ANALYSIS_SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'image/png',
              data:      imageBase64,
            },
          },
          { text: buildChartPrompt(symbol, timeframe) },
        ],
      },
    ],
    generationConfig: {
      // Force JSON output at the API level — model won't wrap in markdown.
      responseMimeType: 'application/json',
      temperature:      0.2,   // Low temperature → consistent, factual analysis
      maxOutputTokens:  8192,
    },
  };

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(35_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        // If 503 high demand or 404, fall back to next model
        if ((response.status === 503 || response.status === 404) && model !== 'gemini-2.5-flash') {
          console.warn(`[Gemini Vision] Model ${model} returned ${response.status}. Falling back to gemini-2.5-flash...`);
          continue;
        }
        throw new Error(`Gemini API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as GeminiResponse;

      if (data.error) {
        throw new Error(`Gemini error ${data.error.code}: ${data.error.message}`);
      }

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned an empty response.');
      }

      let parsed: unknown;
      try {
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        parsed = JSON.parse(cleaned);
      } catch {
        if (candidate?.finishReason === 'MAX_TOKENS') {
          throw new Error('Gemini response exceeded output token limit and was cut off. Increased token headroom.');
        }
        throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 200)}`);
      }

      // Basic structural validation before casting
      const analysis = parsed as Record<string, unknown>;
      if (
        typeof analysis !== 'object' ||
        !analysis.trend ||
        !Array.isArray(analysis.key_levels)
      ) {
        throw new Error(`Gemini response missing expected fields: ${text.slice(0, 200)}`);
      }

      // Always override the disclaimer — never trust the model to include it.
      analysis.disclaimer =
        '⚠️ Not financial advice. For paper trading and educational use only.';

      return {
        analysis: analysis as unknown as ChartAnalysis,
        model,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (model !== 'gemini-2.5-flash') {
        console.warn(`[Gemini Vision] Call with ${model} failed, trying fallback:`, lastError.message);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Gemini chart analysis failed on all models.');
}
