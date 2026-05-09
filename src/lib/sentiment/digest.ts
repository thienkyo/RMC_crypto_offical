/**
 * Hourly digest generator.
 *
 * Prefers Claude (Anthropic) for quality; falls back to Gemini if
 * ANTHROPIC_API_KEY is not set. Only GEMINI_API_KEY is required.
 *
 * Cached for 30 min per symbol in a module-level Map — generated on-demand
 * when the user clicks "Generate Digest", not pre-built for all symbols.
 *
 * Server-side only.
 */

import type { NewsArticle } from '@/types/news';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL      = 'claude-haiku-4-5-20251001';

const GEMINI_MODEL      = 'gemini-2.0-flash-lite';
const GEMINI_API_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const SYSTEM_PROMPT =
  'You are a concise crypto/stock market analyst. ' +
  'Write a 2-3 sentence narrative summary of what the news is saying about an asset in the last hour. ' +
  'Focus on dominant sentiment, key themes, and any notable divergence. ' +
  'Be factual and measured. End with one sentence on overall market tone. ' +
  'Never give financial advice or price predictions.';

interface DigestCache {
  text:        string;
  generatedAt: number;
}

const digestCache = new Map<string, DigestCache>();

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?:   { type: string; message: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?:      { code: number; message: string };
}

function buildArticleList(articles: NewsArticle[]): string {
  return articles
    .slice(0, 8)
    .map((a, i) => {
      const label  = a.sentimentLabel ?? 'neutral';
      const score  = a.sentimentScore != null ? a.sentimentScore.toFixed(2) : '0.00';
      return `${i + 1}. [${label.toUpperCase()} ${score}] (${a.source}) ${a.title}${
        a.sentimentSummary ? ` — ${a.sentimentSummary}` : ''
      }`;
    })
    .join('\n');
}

async function callClaude(symbol: string, articleList: string): Promise<string | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;

  const res = await fetch(ANTHROPIC_API_URL, {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 200,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `Summarise the current news narrative for ${symbol}:\n\n${articleList}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as AnthropicResponse;
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? null;
}

async function callGemini(symbol: string, articleList: string): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  const prompt = `${SYSTEM_PROMPT}\n\nSummarise the current news narrative for ${symbol}:\n\n${articleList}`;

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateDigest(
  symbol:   string,
  articles: NewsArticle[],
): Promise<{ digest: string; fromCache: boolean; generatedAt: string }> {
  // Cache hit
  const cached = digestCache.get(symbol);
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return { digest: cached.text, fromCache: true, generatedAt: new Date(cached.generatedAt).toISOString() };
  }

  if (articles.length === 0) {
    return {
      digest:      `No significant news found for ${symbol} in the last hour.`,
      fromCache:   false,
      generatedAt: new Date().toISOString(),
    };
  }

  const articleList = buildArticleList(articles);

  let text: string | null = null;
  try {
    // Try Claude first, fall back to Gemini
    text = (await callClaude(symbol, articleList)) ?? (await callGemini(symbol, articleList));
  } catch (err) {
    console.error('[digest] AI call failed:', (err as Error).message);
  }

  const result = text ?? 'Unable to generate digest — check AI API key configuration.';
  const now    = Date.now();
  digestCache.set(symbol, { text: result, generatedAt: now });

  return { digest: result, fromCache: false, generatedAt: new Date(now).toISOString() };
}
