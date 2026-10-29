import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sendTelegramAlert, formatStrategySignalMessage } from '@/lib/alerts/telegram';
import type { SignalMonitorRow } from '@/lib/alerts/signalMonitor';

/**
 * GET /api/signal-monitors
 * Returns all currently open signal monitors so the UI can display active live watches.
 */
export async function GET() {
  try {
    const { rows } = await db.query<SignalMonitorRow>(
      `SELECT * FROM signal_monitors
       WHERE status = 'open'
       ORDER BY created_at DESC`,
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[api/signal-monitors] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch active monitors' }, { status: 500 });
  }
}

/**
 * DELETE /api/signal-monitors?id=123
 * Manually stops/closes an active signal monitor from the UI.
 */
export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id = idStr ? parseInt(idStr, 10) : NaN;
  if (isNaN(id)) {
    return NextResponse.json({ error: 'id (number) is required' }, { status: 400 });
  }

  try {
    await db.query(
      `UPDATE signal_monitors
       SET status = 'closed', exit_reason = 'manual_stop', exit_time = NOW(), last_checked_at = NOW()
       WHERE id = $1`,
      [id],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/signal-monitors] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to stop monitor' }, { status: 500 });
  }
}

/**
 * POST /api/signal-monitors
 * Fires a 1-click test signal to the user's personal ("test") Telegram chat,
 * then immediately sends a threaded reply demonstrating the Post-Signal Monitor report.
 */
export async function POST() {
  try {
    const entryPrice = 64200;
    const currentPrice = 65150;
    const tpPrice = 66768;
    const slPrice = 62916;

    // 1. Send initial sample test signal
    const signalHtml = formatStrategySignalMessage({
      strategyName: 'TEST_MONITOR_DEMO',
      rating: 5,
      symbol: 'BTCUSDT',
      timeframe: '4h',
      direction: 'long',
      entryPrice,
      stopLossPct: 2.0,
      takeProfitPct: 4.0,
      conditionGroups: [
        {
          groupOperator: 'or',
          conditionOperator: 'and',
          label: 'Test Setup',
          conditions: [
            { label: 'RSI(14) < 35', passed: true, value: 31.4 },
            { label: 'EMA(20) > EMA(50)', passed: true, value: 64120 },
          ],
        },
      ],
      timestamp: Date.now(),
    });

    const initialSend = await sendTelegramAlert(signalHtml, 'test-monitor-demo', 'signal');
    if (!initialSend.ok) {
      return NextResponse.json(
        { ok: false, error: initialSend.error ?? 'Failed to send initial test signal' },
        { status: 400 },
      );
    }

    // 2. Send threaded Post-Signal Monitor reply linked to the initial signal's messageId
    const replyHtml = [
      `🛡 <b>Breakeven Armed (+1R Reached) [TEST]</b>`,
      `• <b>Pair:</b> BTCUSDT (4H • TEST_MONITOR_DEMO)`,
      `• <b>Direction:</b> 🟢 LONG`,
      `• <b>Entry:</b> $${entryPrice.toLocaleString('en-US')} → <b>Now:</b> $${currentPrice.toLocaleString('en-US')} (<b>+1.48%</b>)`,
      `• <b>Peak Profit (MFE):</b> +1.55% | <b>Max Drawdown (MAE):</b> -0.22%`,
      `• <b>Targets:</b> SL moved to Entry ($${entryPrice.toLocaleString('en-US')}) | TP: $${tpPrice.toLocaleString('en-US')} (orig SL $${slPrice.toLocaleString('en-US')})`,
      `• <i>Threaded reply test successful — live signals will report here automatically!</i>`,
    ].join('\n');

    const replySend = await sendTelegramAlert(
      replyHtml,
      'test-monitor-demo',
      'signal',
      undefined,
      undefined,
      initialSend.messageId,
    );

    return NextResponse.json({
      ok: replySend.ok,
      initialMessageId: initialSend.messageId,
      replyMessageId: replySend.messageId,
      error: replySend.error,
    });
  } catch (err) {
    console.error('[api/signal-monitors] POST test error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
