/**
 * /api/alerts — CRUD for alert rules.
 *
 * GET    /api/alerts              → list all rules + recent history
 * POST   /api/alerts              → create a new rule
 * PATCH  /api/alerts              → update (enable/disable, rename, etc.)
 * DELETE /api/alerts?id=<uuid>    → delete a rule
 */

import { NextRequest } from 'next/server';
import {
  getAllAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getAlertHistory,
} from '@/lib/db/alerts';
import type { CreateAlertInput, UpdateAlertInput } from '@/types/alert';

export async function GET(): Promise<Response> {
  try {
    const [rules, history] = await Promise.all([
      getAllAlertRules(),
      getAlertHistory(undefined, 100),
    ]);
    return Response.json({ rules, history });
  } catch (err) {
    console.error('[api/alerts GET]', err);
    return Response.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = body as Partial<CreateAlertInput>;

  if (!input.name || !input.symbol || !input.timeframe || !input.condition) {
    return Response.json(
      { error: 'name, symbol, timeframe, and condition are required' },
      { status: 400 },
    );
  }

  try {
    const rule = await createAlertRule(input as CreateAlertInput);
    return Response.json({ rule }, { status: 201 });
  } catch (err) {
    console.error('[api/alerts POST]', err);
    return Response.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const input = body as Partial<UpdateAlertInput>;
  if (!input.id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const rule = await updateAlertRule(input as UpdateAlertInput);
    if (!rule) {
      return Response.json({ error: 'Alert rule not found' }, { status: 404 });
    }
    return Response.json({ rule });
  } catch (err) {
    console.error('[api/alerts PATCH]', err);
    return Response.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id query param is required' }, { status: 400 });
  }

  try {
    const deleted = await deleteAlertRule(id);
    if (!deleted) {
      return Response.json({ error: 'Alert rule not found' }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[api/alerts DELETE]', err);
    return Response.json({ error: 'Failed to delete alert' }, { status: 500 });
  }
}
