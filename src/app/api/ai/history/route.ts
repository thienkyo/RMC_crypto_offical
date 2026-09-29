/**
 * GET /api/ai/history
 *
 * Retrieves historical AI Order Decision & Chart Vision analyses from PostgreSQL.
 * Allows filtering by symbol and/or timeframe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import type { OrderEvaluationResult } from '@/lib/ai/evaluator/types';
import type { ChartAnalysis } from '@/lib/ai/types';

export interface AiHistoryItem {
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'long' | 'short';
  status: 'PASS' | 'CAVEAT' | 'REJECT';
  candleTime: string;
  modelProvider: string;
  createdAt: string;
  evaluation: OrderEvaluationResult;
  vision: {
    analysis: ChartAnalysis;
    model: string;
  } | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  const timeframe = searchParams.get('timeframe')?.trim().toLowerCase();
  const limitParam = parseInt(searchParams.get('limit') || '30', 10);
  const limit = Math.min(Math.max(isNaN(limitParam) ? 30 : limitParam, 1), 100);

  try {
    let query = `
      SELECT 
        e.id,
        e.symbol,
        e.timeframe,
        e.direction,
        e.status,
        e.candle_time,
        e.model_provider,
        e.evaluation,
        e.created_at,
        v.analysis as vision_analysis,
        v.model as vision_model
      FROM ai_order_evaluations e
      LEFT JOIN ai_chart_analysis v
        ON e.symbol = v.symbol
       AND e.timeframe = v.timeframe
       AND ABS(EXTRACT(EPOCH FROM (e.candle_time - v.candle_close_time))) <= 5
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (symbol) {
      params.push(symbol);
      conditions.push(`e.symbol = $${params.length}`);
    }

    if (timeframe) {
      params.push(timeframe);
      conditions.push(`e.timeframe = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    params.push(limit);
    query += ` ORDER BY e.created_at DESC LIMIT $${params.length}`;

    const { rows } = await db.query<{
      id: string;
      symbol: string;
      timeframe: string;
      direction: 'long' | 'short';
      status: 'PASS' | 'CAVEAT' | 'REJECT';
      candle_time: Date;
      model_provider: string;
      evaluation: OrderEvaluationResult;
      created_at: Date;
      vision_analysis: ChartAnalysis | null;
      vision_model: string | null;
    }>(query, params);

    const history: AiHistoryItem[] = rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      timeframe: r.timeframe,
      direction: r.direction,
      status: r.status,
      candleTime: r.candle_time.toISOString(),
      modelProvider: r.model_provider,
      createdAt: r.created_at.toISOString(),
      evaluation: r.evaluation,
      vision: r.vision_analysis
        ? {
            analysis: r.vision_analysis,
            model: r.vision_model || 'gemini',
          }
        : null,
    }));

    return NextResponse.json({ success: true, history });
  } catch (err) {
    console.error('[api/ai/history] Error fetching evaluation history:', err);
    return NextResponse.json(
      { error: 'Failed to fetch evaluation history' },
      { status: 500 },
    );
  }
}
