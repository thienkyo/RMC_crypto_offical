/**
 * GET /api/ai/models
 *
 * Diagnostic endpoint — lists all Gemini models available to your API key
 * and whether each supports generateContent (i.e. usable for chart analysis).
 *
 * Hit this once to find the right model name, then update GEMINI_MODEL in
 * src/lib/ai/gemini.ts.  Not needed in production; safe to leave in.
 */

import { NextResponse } from 'next/server';

interface GeminiModel {
  name:               string;
  displayName:        string;
  supportedGenerationMethods: string[];
}

interface ListModelsResponse {
  models?: GeminiModel[];
  error?:  { code: number; message: string };
}

export async function GET(): Promise<NextResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not set.' }, { status: 500 });
  }

  const res  = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  const data = (await res.json()) as ListModelsResponse;

  if (data.error) {
    return NextResponse.json(data, { status: res.status });
  }

  // Filter to models that support generateContent and return a clean list.
  const usable = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({ name: m.name, displayName: m.displayName }));

  return NextResponse.json({ usable, all: data.models?.map((m) => m.name) });
}
