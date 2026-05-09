/**
 * Gemini batch sentiment classifier.
 *
 * Sends up to 50 article titles to Gemini in a single API call and returns
 * sentiment score + label for each. Cheap — uses the same lite model as chart
 * analysis since this is a simple classification task, not vision.
 *
 * Server-side only. Requires GEMINI_API_KEY in env.
 */

import type { NewsArticle } from '@/types/news';

const GEMINI_MODEL   = 'gemini-2.0-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface SentimentResult {
  score: number;   // -1.0 to +1.0
  label: 'bearish' | 'neutral' | 'bullish';
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { code: number; message: string };
}

const SYSTEM_PROMPT = `You are a financial sentiment classifier for crypto and stock market news.

For each article title provided (numbered list), return a JSON array in the SAME ORDER.
Each element must be: { "score": <float from -1.0 to +1.0>, "label": "bearish" | "neutral" | "bullish" }

Score guide:
  -1.0 = extremely bearish (major hack, crash, ban, fraud)
  -0.5 = moderately bearish (negative regulation, sell-off, concern)
   0.0 = neutral (factual update, price data, analysis without bias)
  +0.5 = moderately bullish (adoption, partnership, positive regulation)
  +1.0 = extremely bullish (major institutional buy, breakout, milestone)

Be conservative — most news is neutral (±0.1). Only use extreme scores for clearly extreme events.
Return ONLY valid JSON array, no markdown or explanation.`;

/**
 * Classify sentiment for a batch of articles using Gemini.
 * Articles that fail to parse get score=0, label='neutral'.
 */
export async function classifyBatch(
  articles: Pick<NewsArticle, 'id' | 'title'>[],
): Promise<Map<string, SentimentResult>> {
  const results = new Map<string, SentimentResult>();

  if (articles.length === 0) return results;

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const numbered = articles
    .map((a, i) => `${i + 1}. ${a.title}`)
    .join('\n');

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: numbered }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature:      0.1,
      maxOutputTokens:  1024,
    },
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Gemini classify error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.error) throw new Error(`Gemini error ${data.error.code}: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let parsed: SentimentResult[];
  try {
    parsed = JSON.parse(text) as SentimentResult[];
  } catch {
    console.error('[classify] bad JSON from Gemini:', text.slice(0, 200));
    // Graceful fallback — mark all as neutral
    parsed = articles.map(() => ({ score: 0, label: 'neutral' as const }));
  }

  // Map results back to article IDs by position
  articles.forEach((article, i) => {
    const raw = parsed[i];
    if (!raw) {
      results.set(article.id, { score: 0, label: 'neutral' });
      return;
    }
    const score = Math.max(-1, Math.min(1, typeof raw.score === 'number' ? raw.score : 0));
    const label  = ['bearish', 'neutral', 'bullish'].includes(raw.label)
      ? raw.label
      : (score > 0.15 ? 'bullish' : score < -0.15 ? 'bearish' : 'neutral');
    results.set(article.id, { score, label });
  });

  return results;
}
