import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';

/** All keys we recognise — any other key in a POST body is silently ignored. */
const ALLOWED_KEYS = [
  'telegram_personal_chat_id',
  'telegram_group_chat_id',
  'telegram_alert_chat_id',
  'gemini_api_key',
  'anthropic_api_key',
  'openai_api_key',
  'gemini_evaluator_model',
  'anthropic_evaluator_model',
  'openai_evaluator_model',
  'ai_evaluator_max_tokens',
  'ai_evaluator_max_cost_usd',
  'ai_evaluator_monthly_budget_usd',
  'enable_ai_signal_gatekeeper',
] as const;

export type SettingKey = (typeof ALLOWED_KEYS)[number];

/** Shape returned by GET /api/settings */
export interface AppSettings {
  telegram_personal_chat_id: string | null;
  telegram_group_chat_id:    string | null;
  telegram_alert_chat_id:    string | null;
  gemini_api_key:            string | null;
  anthropic_api_key:         string | null;
  openai_api_key:            string | null;
  gemini_evaluator_model:    string | null;
  anthropic_evaluator_model: string | null;
  openai_evaluator_model:    string | null;
  ai_evaluator_max_tokens:   string | null;
  ai_evaluator_max_cost_usd: string | null;
  ai_evaluator_monthly_budget_usd: string | null;
  enable_ai_signal_gatekeeper: string | null;
}

// ── GET /api/settings ─────────────────────────────────────────────────────────

export async function GET() {
  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings WHERE key = ANY($1)`,
      [ALLOWED_KEYS],
    );

    // Build a fully-typed object even if some rows are missing from DB
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    const settings: AppSettings = {
      telegram_personal_chat_id: map['telegram_personal_chat_id'] ?? null,
      telegram_group_chat_id:    map['telegram_group_chat_id']    ?? null,
      telegram_alert_chat_id:    map['telegram_alert_chat_id']    ?? null,
      gemini_api_key:            map['gemini_api_key']            ?? null,
      anthropic_api_key:         map['anthropic_api_key']         ?? null,
      openai_api_key:            map['openai_api_key']            ?? null,
      gemini_evaluator_model:    map['gemini_evaluator_model']    ?? null,
      anthropic_evaluator_model: map['anthropic_evaluator_model'] ?? null,
      openai_evaluator_model:    map['openai_evaluator_model']    ?? null,
      ai_evaluator_max_tokens:   map['ai_evaluator_max_tokens']   ?? null,
      ai_evaluator_max_cost_usd: map['ai_evaluator_max_cost_usd'] ?? null,
      ai_evaluator_monthly_budget_usd: map['ai_evaluator_monthly_budget_usd'] ?? null,
      enable_ai_signal_gatekeeper: map['enable_ai_signal_gatekeeper'] ?? null,
    };


    return NextResponse.json(settings);
  } catch (err) {
    console.error('[api/settings] GET error:', err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// ── POST /api/settings ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Record<string, string | null>>;

    // Only process keys we explicitly allow
    const entries = Object.entries(body).filter(([k]) =>
      (ALLOWED_KEYS as readonly string[]).includes(k),
    );

    if (entries.length === 0) {
      return NextResponse.json({ error: 'No valid settings keys provided' }, { status: 400 });
    }

    // Upsert each key individually so we don't need unnest tricks
    for (const [key, value] of entries) {
      // Treat empty string as NULL so we can distinguish "never set" from "set to empty"
      const stored = value === '' ? null : (value ?? null);
      await db.query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, stored],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/settings] POST error:', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
