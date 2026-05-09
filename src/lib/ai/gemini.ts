/**
 * Gemini Vision client — server-side only.
 *
 * Uses the Gemini REST API directly (no SDK) to avoid extra dependencies.
 * Model: gemini-2.0-flash — fast, cheap, solid vision quality for charts.
 *
 * Never import this file from client components; it reads GEMINI_API_KEY from
 * process.env which is only available server-side.
 */

import type { ChartAnalysis } from './types';
import { CHART_ANALYSIS_SYSTEM_PROMPT, buildChartPrompt } from './prompts';

const GEMINI_MODEL   = 'gemini-3.1-flash-lite-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

/**
 * Send a chart image to Gemini and return a parsed ChartAnalysis.
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
): Promise<ChartAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables.');
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
      maxOutputTokens:  1024,
    },
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;

  if (data.error) {
    throw new Error(`Gemini error ${data.error.code}: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
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
  (analysis as Record<string, unknown>).disclaimer =
    '⚠️ Not financial advice. For paper trading and educational use only.';

  return analysis as unknown as ChartAnalysis;
}

export const GEMINI_MODEL_NAME = GEMINI_MODEL;
