/**
 * /api/strategies — server-side strategy persistence.
 *
 * Strategies are authoritative in Zustand/localStorage for the UI.
 * This endpoint provides DB durability so the cron can read them.
 *
 * GET  /api/strategies          → all strategies from DB (for cron / debug)
 * POST /api/strategies          → upsert one strategy (called by StrategyForm on save)
 * DELETE /api/strategies?id=x   → remove a strategy from DB
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import type { Strategy } from '@/types/strategy';

// ── Row mapper ────────────────────────────────────────────────────────────────

function rowToStrategy(row: Record<string, unknown>): Strategy {
  return row['definition'] as Strategy;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const { rows } = await db.query(
      `SELECT definition FROM strategies ORDER BY updated_at DESC`,
    );
    return Response.json({ strategies: rows.map(rowToStrategy) });
  } catch (err) {
    console.error('[api/strategies GET]', err);
    return Response.json({ error: 'Failed to fetch strategies' }, { status: 500 });
  }
}

// ── POST (upsert) ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  let strategy: Strategy;
  try {
    strategy = await req.json() as Strategy;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!strategy.id || !strategy.name || !strategy.symbol || !strategy.timeframe) {
    return Response.json({ error: 'id, name, symbol, and timeframe are required' }, { status: 400 });
  }

  try {
    await db.query(
      `INSERT INTO strategies
         (id, name, description, version, symbol, timeframe, definition, notify_on_signal, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name             = EXCLUDED.name,
         description      = EXCLUDED.description,
         version          = EXCLUDED.version,
         symbol           = EXCLUDED.symbol,
         timeframe        = EXCLUDED.timeframe,
         definition       = EXCLUDED.definition,
         notify_on_signal = EXCLUDED.notify_on_signal,
         updated_at       = NOW()`,
      [
        strategy.id,
        strategy.name,
        strategy.description ?? '',
        strategy.version,
        strategy.symbol,
        strategy.timeframe,
        JSON.stringify(strategy),
        strategy.notifyOnSignal ?? false,
      ],
    );

    // Snapshot this version for diffing / rollback.
    await db.query(
      `INSERT INTO strategy_versions (strategy_id, version, definition)
       VALUES ($1, $2, $3)
       ON CONFLICT (strategy_id, version) DO UPDATE SET definition = EXCLUDED.definition`,
      [strategy.id, strategy.version, JSON.stringify(strategy)],
    ).catch((err) => {
      // Non-fatal — version snapshot failure shouldn't abort the upsert.
      console.warn('[api/strategies] Version snapshot failed:', err);
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[api/strategies POST]', err);
    return Response.json({ error: 'Failed to save strategy' }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

  try {
    await db.query(`DELETE FROM strategies WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[api/strategies DELETE]', err);
    return Response.json({ error: 'Failed to delete strategy' }, { status: 500 });
  }
}
