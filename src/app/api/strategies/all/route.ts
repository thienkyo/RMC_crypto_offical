/**
 * DELETE /api/strategies/all — wipe the entire strategy library from the DB.
 *
 * Used by the "Clear All" and Import (Replace mode) flows so that DB stays in
 * sync with localStorage.  strategy_versions cascade-delete via FK.
 * strategy_signals are intentionally kept — they have no FK to strategies and
 * represent historical signal records the user may want to preserve.
 */

import { db } from '@/lib/db/client';

export async function DELETE(): Promise<Response> {
  try {
    const { rowCount } = await db.query(`DELETE FROM strategies`);
    return Response.json({ ok: true, deleted: rowCount ?? 0 });
  } catch (err) {
    console.error('[api/strategies/all DELETE]', err);
    return Response.json({ error: 'Failed to delete all strategies' }, { status: 500 });
  }
}
