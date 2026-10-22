import { NextRequest, NextResponse } from 'next/server';
import { resolveSignals } from '@/lib/strategy/resolver';

export async function POST(req: NextRequest) {
  try {
    let forceAll = true;
    let sinceMs: number | undefined;
    let untilMs: number | undefined;
    let entryMode: 'limit' | 'market' | undefined;
    let breakevenAt1R: boolean | undefined;
    let maxWaitBars: number | undefined;
    try {
      const body = await req.json();
      if (typeof body?.forceAll === 'boolean') {
        forceAll = body.forceAll;
      }
      if (typeof body?.sinceMs === 'number' && Number.isFinite(body.sinceMs)) {
        sinceMs = body.sinceMs;
      }
      if (typeof body?.untilMs === 'number' && Number.isFinite(body.untilMs)) {
        untilMs = body.untilMs;
      }
      if (body?.entryMode === 'limit' || body?.entryMode === 'market') {
        entryMode = body.entryMode;
      }
      if (typeof body?.breakevenAt1R === 'boolean') {
        breakevenAt1R = body.breakevenAt1R;
      }
      if (typeof body?.maxWaitBars === 'number' && Number.isFinite(body.maxWaitBars) && body.maxWaitBars > 0) {
        maxWaitBars = body.maxWaitBars;
      }
    } catch {
      // Empty body or non-JSON is fine, defaults to forceAll = true
    }

    const summary = await resolveSignals({
      forceAll,
      sinceMs,
      untilMs,
      entryMode,
      breakevenAt1R,
      maxWaitBars,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('[api/strategy-signals/resolve] Error resolving signals:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to resolve signals' },
      { status: 500 },
    );
  }
}
