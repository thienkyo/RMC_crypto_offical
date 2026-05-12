import { db } from '@/lib/db/client';
import { SettingsForm } from '@/components/settings/SettingsForm';
import type { AppSettings } from '@/app/api/settings/route';

/**
 * Settings page — Server Component.
 * Reads current settings directly from Postgres (no extra fetch round-trip)
 * and pre-populates the client form.
 *
 * Next.js App Router: this page is dynamic (no static generation) because it
 * reads from a live database.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  // Load all known setting keys from DB
  let settings: AppSettings = {
    telegram_personal_chat_id: null,
    telegram_group_chat_id:    null,
  };

  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings
       WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id')`,
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    settings = {
      telegram_personal_chat_id: map['telegram_personal_chat_id'] ?? null,
      telegram_group_chat_id:    map['telegram_group_chat_id']    ?? null,
    };
  } catch (err) {
    // DB may not have run the latest migration yet — form still renders with empty defaults
    console.warn('[settings/page] Could not load settings from DB:', err);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-base font-semibold text-text-primary tracking-wide mb-1">
            Settings
          </h1>
          <p className="text-xs text-text-secondary">
            Global configuration for the RMC dashboard. Changes take effect immediately — no restart needed.
          </p>
        </div>

        {/* ── Settings form ─────────────────────────────────────────────── */}
        <SettingsForm initial={settings} />

      </div>
    </div>
  );
}
