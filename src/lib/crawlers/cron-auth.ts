/**
 * Shared cron route authentication helper.
 *
 * Vercel cron jobs send `Authorization: Bearer <CRON_SECRET>`.
 * In local dev, skip the check when CRON_SECRET is not set.
 */

import { NextRequest } from 'next/server';

export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env['CRON_SECRET'];
  // Local dev: no secret set → allow all requests (localhost only anyway)
  if (!secret) return true;

  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export function cronUnauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
