/**
 * GET /api/strategies/[id]/versions/[v]
 *
 * Returns the full strategy definition snapshot for a specific version number.
 * Used by the Preview and Diff panels in the History tab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import type { Strategy } from '@/types/strategy';

interface RouteContext {
  params: Promise<{ id: string; v: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id, v } = await params;
  const version = parseInt(v, 10);

  if (isNaN(version) || version < 1) {
    return NextResponse.json({ error: 'Invalid version number' }, { status: 400 });
  }

  try {
    const { rows } = await db.query<{ definition: Strategy; saved_at: string }>(
      `SELECT definition, saved_at
       FROM strategy_versions
       WHERE strategy_id = $1 AND version = $2`,
      [id, version],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    return NextResponse.json({
      version,
      savedAt:    rows[0]!.saved_at,
      definition: rows[0]!.definition,
    });
  } catch (err) {
    console.error('[versions/[v] GET]', err);
    return NextResponse.json({ error: 'Failed to fetch version' }, { status: 500 });
  }
}
