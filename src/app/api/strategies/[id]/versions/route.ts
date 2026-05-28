/**
 * GET /api/strategies/[id]/versions
 *
 * Returns the version list for one strategy — lightweight metadata only
 * (no full definition). Used by the History tab to render the timeline.
 *
 * DELETE /api/strategies/[id]/versions?keep=N
 *
 * Prunes old versions, keeping the N most recent. Used by the "Prune" button.
 * N defaults to 20 if the query param is missing or invalid.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── GET — version list ────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const { rows } = await db.query<{
      version:  number;
      saved_at: string;
      name:     string;
    }>(
      `SELECT
         sv.version,
         sv.saved_at,
         -- Pull name from the snapshot so the list shows the name at that point in time
         sv.definition->>'name' AS name
       FROM strategy_versions sv
       WHERE sv.strategy_id = $1
       ORDER BY sv.version DESC`,
      [id],
    );

    return NextResponse.json({ versions: rows });
  } catch (err) {
    console.error('[versions GET]', err);
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }
}

// ── DELETE — prune old versions ───────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const keepParam = req.nextUrl.searchParams.get('keep');
  const keep = Math.max(1, parseInt(keepParam ?? '20', 10) || 20);

  try {
    const { rowCount } = await db.query(
      `DELETE FROM strategy_versions
       WHERE strategy_id = $1
         AND version NOT IN (
           SELECT version FROM strategy_versions
           WHERE strategy_id = $1
           ORDER BY version DESC
           LIMIT $2
         )`,
      [id, keep],
    );

    return NextResponse.json({ deleted: rowCount ?? 0, kept: keep });
  } catch (err) {
    console.error('[versions DELETE/prune]', err);
    return NextResponse.json({ error: 'Failed to prune versions' }, { status: 500 });
  }
}
