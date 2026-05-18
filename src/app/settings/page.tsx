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
    telegram_alert_chat_id:    null,
  };

  try {
    const { rows } = await db.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM settings
       WHERE key IN ('telegram_personal_chat_id', 'telegram_group_chat_id', 'telegram_alert_chat_id')`,
    );
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    settings = {
      telegram_personal_chat_id: map['telegram_personal_chat_id'] ?? null,
      telegram_group_chat_id:    map['telegram_group_chat_id']    ?? null,
      telegram_alert_chat_id:    map['telegram_alert_chat_id']    ?? null,
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

        {/* ── Q&A ───────────────────────────────────────────────────────── */}
        <div className="mt-12 border-t border-surface-border pt-8">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-text-muted text-sm">?</span>
            <h2 className="text-sm font-semibold text-text-primary tracking-wide">Q&amp;A</h2>
          </div>

          {/* ── Q: Chart markers ──────────────────────────────────────────── */}
          <div className="mb-8">
            <p className="text-xs font-semibold text-text-primary mb-3">
              What do the chart markers mean?
            </p>

            <div className="flex flex-col gap-px rounded border border-surface-border overflow-hidden text-xs">

              {/* Header row */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface-2">
                <span className="px-3 py-2 font-semibold text-text-muted uppercase tracking-wider text-[10px]">Marker</span>
                <span className="px-3 py-2 font-semibold text-text-muted uppercase tracking-wider text-[10px]">Shape</span>
                <span className="px-3 py-2 font-semibold text-text-muted uppercase tracking-wider text-[10px]">Meaning</span>
              </div>

              {/* Yellow square */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface border-t border-surface-border">
                <div className="px-3 py-2.5 flex items-center">
                  <span className="inline-block w-3 h-3 rounded-sm bg-amber-400 flex-shrink-0" />
                </div>
                <span className="px-3 py-2.5 font-mono text-text-muted">square sm</span>
                <div className="px-3 py-2.5 text-text-secondary leading-relaxed">
                  <span className="text-amber-400 font-semibold">Raw condition signal.</span>{' '}
                  Entry conditions fired on this closed candle. Appears even when already in a position.
                  This is the <span className="text-text-primary font-medium">exact bar that triggers a Telegram notification</span>.
                </div>
              </div>

              {/* Green arrow up */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface border-t border-surface-border">
                <div className="px-3 py-2.5 flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold text-base leading-none">↑</span>
                  <span className="text-red-400 font-bold text-base leading-none">↓</span>
                </div>
                <span className="px-3 py-2.5 font-mono text-text-muted">arrow lg</span>
                <div className="px-3 py-2.5 text-text-secondary leading-relaxed">
                  <span className="text-emerald-400 font-semibold">Position opened.</span>{' '}
                  Green ↑ = long entry, red ↓ = short entry. Labelled with strategy name + direction.
                  Respects SL/TP and <code className="text-blue-300 bg-surface-border/60 px-1 rounded">maxPositions</code> cap —
                  fewer than raw signal squares.
                </div>
              </div>

              {/* Circle exit */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface border-t border-surface-border">
                <div className="px-3 py-2.5 flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full bg-emerald-400 flex-shrink-0" />
                  <span className="inline-block w-3 h-3 rounded-full bg-red-400 flex-shrink-0" />
                </div>
                <span className="px-3 py-2.5 font-mono text-text-muted">circle sm</span>
                <div className="px-3 py-2.5 text-text-secondary leading-relaxed">
                  <span className="text-text-primary font-semibold">Position closed.</span>{' '}
                  Green = profitable exit, red = loss. Labelled with P&amp;L e.g.{' '}
                  <code className="text-emerald-400 bg-surface-border/60 px-1 rounded">+2.3%</code> or{' '}
                  <code className="text-red-400 bg-surface-border/60 px-1 rounded">-1.1%</code>.
                  Not shown when position is still open at end of data.
                </div>
              </div>

              {/* Pattern arrows */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface border-t border-surface-border">
                <div className="px-3 py-2.5 flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold text-base leading-none">↑</span>
                  <span className="text-red-400 font-bold text-base leading-none">↓</span>
                </div>
                <span className="px-3 py-2.5 font-mono text-text-muted">varies</span>
                <div className="px-3 py-2.5 text-text-secondary leading-relaxed">
                  <span className="text-violet-400 font-semibold">Candlestick pattern.</span>{' '}
                  Bullish patterns appear below the bar (green ↑), bearish above (red ↓).
                  Labelled with the pattern name. Only visible when a pattern indicator is active.
                </div>
              </div>

              {/* Drop-lines */}
              <div className="grid grid-cols-[80px_60px_1fr] gap-0 bg-surface border-t border-surface-border">
                <div className="px-3 py-2.5 flex items-center">
                  <div className="w-px h-5 bg-blue-400/70 flex-shrink-0" />
                </div>
                <span className="px-3 py-2.5 font-mono text-text-muted">vert. line</span>
                <div className="px-3 py-2.5 text-text-secondary leading-relaxed">
                  <span className="text-blue-400 font-semibold">Signal drop-line.</span>{' '}
                  Faded vertical line spanning the full chart height at each trade entry/exit.
                  Colored per strategy slot. Strategy name appears at the bottom.
                  Disappears when the bar scrolls off screen.
                </div>
              </div>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
