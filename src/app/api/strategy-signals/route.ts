import { NextRequest, NextResponse } from 'next/server';
import {
  getSignalsForStrategy,
  updateSignalOutcome,
  deleteSignal,
} from '@/lib/db/signals';

// ── GET /api/strategy-signals?strategyId=xxx ──────────────────────────────────

export async function GET(req: NextRequest) {
  const strategyId = req.nextUrl.searchParams.get('strategyId');
  if (!strategyId) {
    return NextResponse.json({ error: 'strategyId is required' }, { status: 400 });
  }

  try {
    const signals = await getSignalsForStrategy(strategyId);
    return NextResponse.json(signals);
  } catch (err) {
    console.error('[api/strategy-signals] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 });
  }
}

// ── PATCH /api/strategy-signals — update outcome ──────────────────────────────
//
// Body: { id: number; pnlPct: number | null; note?: string }
//
// pnlPct parsing rules (matches what the user types in UI or Telegram):
//   "+3.5"   → 3.5
//   "-2.1"   → -2.1
//   "+3.5%"  → 3.5
//   "3.5%"   → 3.5      (positive assumed when no sign)
//   "-2.1%"  → -2.1
//   null     → null      (clears the outcome)

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id: number; pnlPct: string | number | null; note?: string };

    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id (number) is required' }, { status: 400 });
    }

    let pnlPct: number | null = null;
    if (body.pnlPct !== null && body.pnlPct !== undefined && body.pnlPct !== '') {
      const parsed = parsePnl(String(body.pnlPct));
      if (parsed === null) {
        return NextResponse.json({ error: `Cannot parse pnlPct: "${body.pnlPct}"` }, { status: 400 });
      }
      pnlPct = parsed;
    }

    await updateSignalOutcome(body.id, pnlPct, body.note);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse user-entered P&L strings into a float.
 * Accepts: "+3.5", "-2.1", "+3.5%", "-2.1%", "3.5", "3.5%"
 * Returns null if the string cannot be parsed.
 */
function parsePnl(raw: string): number | null {
  const cleaned = raw.trim().replace(/%$/, '');   // strip trailing %
  const value   = parseFloat(cleaned);
  if (isNaN(value)) return null;
  return value;
}
