/**
 * POST /api/ai/send-telegram
 *
 * Dispatches an AI Order Evaluation report (along with an optional vision chart screenshot)
 * to the configured Telegram group chat ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendAiEvaluationToTelegram } from '@/lib/alerts/telegram';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { symbol, timeframe, direction, entryPrice, evaluation } = body;

    if (!symbol || !timeframe || !direction || entryPrice == null || !evaluation) {
      return NextResponse.json(
        { ok: false, error: 'Missing required parameters: symbol, timeframe, direction, entryPrice, evaluation' },
        { status: 400 }
      );
    }

    const result = await sendAiEvaluationToTelegram(body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, delivered: result.delivered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/ai/send-telegram error]', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
