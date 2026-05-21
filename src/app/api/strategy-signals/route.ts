import { NextRequest, NextResponse } from 'next/server';
import {
  getAllSignals,
  getSignalsForStrategy,
  updateSignalOutcome,
  deleteSignal,
} from '@/lib/db/signals';

// ── GET /api/strategy-signals[?strategyId=xxx] ────────────────────────────────
//
// Without strategyId → returns ALL signals across all strategies (portfolio view).
// With    strategyId → returns signals for that strategy only.

export async function GET(req: NextRequest) {
  const strategyId = req.nextUrl.searchParams.get('strategyId');

  try {
    const signals = strategyId
      ? await getSignalsForStrategy(strategyId)
      : await getAllSignals();
    return NextResponse.json(signals);
  } catch (err) {
    console.error('[api/strategy-signals] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 });
  }
}

// ── PATCH /api/strategy-signals — record actual trade prices ─────────────────
//
// Body: {
//   id:               number;
//   direction:        'long' | 'short';
//   actualEntryPrice: number | null;   // user's actual Binance buy price
//   actualExitPrice:  number | null;   // user's actual Binance exit price
//   note?:            string;
// }
//
// pnl_pct is computed server-side: pass null for both prices to clear outcome.

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id:               number;
      direction:        'long' | 'short';
      actualEntryPrice: number | null;
      actualExitPrice:  number | null;
      note?:            string;
    };

    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id (number) is required' }, { status: 400 });
    }
    if (body.direction !== 'long' && body.direction !== 'short') {
      return NextResponse.json({ error: 'direction must be "long" or "short"' }, { status: 400 });
    }

    const entryPrice = typeof body.actualEntryPrice === 'number' ? body.actualEntryPrice : null;
    const exitPrice  = typeof body.actualExitPrice  === 'number' ? body.actualExitPrice  : null;

    await updateSignalOutcome(body.id, entryPrice, exitPrice, body.direction, body.note);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/strategy-signals] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update signal' }, { status: 500 });
  }
}

// ── DELETE /api/strategy-signals?id=123 ──────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const idStr = req.nextUrl.searchParams.get('id');
  const id    = idStr ? parseInt(idStr, 10) : NaN;

  if (isNaN(id)) {
    return NextResponse.json({ error: 'id (number) is required' }, { status: 400 });
  }

  try {
    await deleteSignal(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/strategy-signals] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete signal' }, { status: 500 });
  }
}

