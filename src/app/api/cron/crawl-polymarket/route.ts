/**
 * POST /api/cron/crawl-polymarket
 *
 * Fetches active crypto prediction markets from Polymarket and stores snapshots.
 * Runs every 10 min via Vercel cron. No API key required.
 */

import { NextRequest } from 'next/server';
import { crawlPolymarket } from '@/lib/crawlers/polymarket';
import { isCronAuthorized, cronUnauthorized } from '@/lib/crawlers/cron-auth';

export const maxDuration = 20;

export async function POST(req: NextRequest): Promise<Response> {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  try {
    const result = await crawlPolymarket();
    console.log(`[cron:polymarket] +${result.inserted} snapshots`);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron:polymarket] error:', (err as Error).message);
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
