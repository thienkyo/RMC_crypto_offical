/**
 * POST /api/ai/chart-analysis
 *
 * Accepts a chart screenshot + context, checks the Postgres cache, and
 * returns a structured ChartAnalysis JSON from Gemini.
 *
 * Cache key: (symbol, timeframe, candle_close_time)
 * Cost discipline: every analysis is cached per bar — re-analyzing the same
 * closed candle never burns Gemini credits twice.
 *
 * Next.js note: This is a Route Handler (App Router).  It runs server-side,
 * so it can safely read GEMINI_API_KEY and query Postgres.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { analyzeChartWithGemini, GEMINI_MODEL_NAME } from '@/lib/ai/gemini';
import type {
  AnalyzeChartRequest,
  AnalyzeChartResponse,
  ChartAnalysis,
} from '@/lib/ai/types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse and validate request body ─────────────────────────────────────
  let body: AnalyzeChartRequest;
  try {
    body = (await req.json()) as AnalyzeChartRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { imageBase64, symbol, timeframe, lastCandleTime } = body;

  if (!imageBase64 || !symbol || !timeframe || !lastCandleTime) {
    return NextResponse.json(
      { error: 'Missing required fields: imageBase64, symbol, timeframe, lastCandleTime.' },
      { status: 400 },
    );
  }

  if (typeof lastCandleTime !== 'number' || lastCandleTime <= 0) {
    return NextResponse.json(
      { error: 'lastCandleTime must be a positive Unix ms timestamp.' },
      { status: 400 },
    );
  }

  // ── 2. Check cache ──────────────────────────────────────────────────────────
  const candleCloseTs = new Date(lastCandleTime).toISOString();

  try {
    const cacheResult = await db.query<{
      analysis:   ChartAnalysis;
      model:      string;
      created_at: Date;
    }>(
      `SELECT analysis, model, created_at
       FROM ai_chart_analysis
       WHERE symbol = $1
         AND timeframe = $2
         AND candle_close_time = $3
       LIMIT 1`,
      [symbol, timeframe, candleCloseTs],
    );

    if (cacheResult.rows.length > 0) {
      const row = cacheResult.rows[0]!;
      const response: AnalyzeChartResponse = {
        analysis:  row.analysis,
        fromCache: true,
        cachedAt:  row.created_at.toISOString(),
        model:     row.model,
      };
      return NextResponse.json(response);
    }
  } catch (err) {
    // DB errors on the cache check shouldn't block analysis — log and continue.
    console.error('[chart-analysis] cache lookup failed:', err);
  }

  // ── 3. Call Gemini ──────────────────────────────────────────────────────────
  let analysis: ChartAnalysis;
  try {
    analysis = await analyzeChartWithGemini(imageBase64, symbol, timeframe);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[chart-analysis] Gemini call failed:', message);
    return NextResponse.json(
      { error: `AI analysis failed: ${message}` },
      { status: 502 },
    );
  }

  // ── 4. Persist to cache ─────────────────────────────────────────────────────
  try {
    await db.query(
      `INSERT INTO ai_chart_analysis
         (symbol, timeframe, candle_close_time, analysis, model)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol, timeframe, candle_close_time) DO NOTHING`,
      [symbol, timeframe, candleCloseTs, JSON.stringify(analysis), GEMINI_MODEL_NAME],
    );
  } catch (err) {
    // Cache write failure is non-fatal — return the analysis anyway.
    console.error('[chart-analysis] cache write failed:', err);
  }

  // ── 5. Return ───────────────────────────────────────────────────────────────
  const response: AnalyzeChartResponse = {
    analysis,
    fromCache: false,
    model:     GEMINI_MODEL_NAME,
  };
  return NextResponse.json(response);
}
