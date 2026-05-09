/**
 * Article 1-sentence summarizer.
 *
 * Prefers Claude (Anthropic) for quality; falls back to Gemini if
 * ANTHROPIC_API_KEY is not set. Only GEMINI_API_KEY is required.
 *
 * Server-side only.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL      = 'claude-haiku-4-5-20251001';

const GEMINI_MODEL      = 'gemini-2.0-flash-lite';
const GEMINI_API_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT =
  'Summarise this crypto/stock news article in exactly one sentence (max 25 words). ' +
  'Focus on: what happened, which asset, and the likely market implication. ' +
  'Do not start with "This article", "The article", or "This news". ' +
  'Be specific and factual.';

// ─── Claude path ─────────────────────────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?:   { type: string; message: string };
}

async function summarizeWithClaude(title: string, body: string | null): Promise<string | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null; // signal to try Gemini

  const res = await fetch(ANTHROPIC_API_URL, {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 80,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `Title: ${title}\nBody: ${body ?? '(none)'}` }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as AnthropicResponse;
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? null;
}

// ─── Gemini path ─────────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?:      { code: number; message: string };
}

async function summarizeWithGemini(title: string, body: string | null): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  const prompt = `${SYSTEM_PROMPT}\n\nTitle: ${title}\nBody: ${body ?? '(none)'}`;

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 80 },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as GeminiResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a 1-sentence summary for a high-signal article.
 * Tries Claude first; falls back to Gemini. Returns null on total failure (non-fatal).
 */
export async function summarizeArticle(
  title: string,
  body:  string | null,
): Promise<string | null> {
  try {
    return (await summarizeWithClaude(title, body)) ?? (await summarizeWithGemini(title, body));
  } catch (err) {
    console.error('[summarize] failed:', (err as Error).message);
    return null;
  }
}
