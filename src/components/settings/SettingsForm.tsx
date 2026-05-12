'use client';

import { useState, useTransition } from 'react';
import type { AppSettings } from '@/app/api/settings/route';

interface Props {
  initial: AppSettings;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Settings form — fully client-side so we get instant feedback.
 * Submits to POST /api/settings via fetch; no full page reload.
 */
export function SettingsForm({ initial }: Props) {
  const [personalIds, setPersonalIds] = useState(initial.telegram_personal_chat_id ?? '');
  const [groupIds,    setGroupIds]    = useState(initial.telegram_group_chat_id    ?? '');
  const [saveState,   setSaveState]   = useState<SaveState>('idle');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [, startTransition]           = useTransition();

  const isDirty =
    personalIds !== (initial.telegram_personal_chat_id ?? '') ||
    groupIds    !== (initial.telegram_group_chat_id    ?? '');

  async function handleSave() {
    setSaveState('saving');
    setErrorMsg('');

    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_personal_chat_id: personalIds,
          telegram_group_chat_id:    groupIds,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      setSaveState('saved');
      startTransition(() => {
        setTimeout(() => setSaveState('idle'), 2_000);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setSaveState('error');
    }
  }

  return (
    <div className="flex flex-col gap-8 max-w-2xl">

      {/* ── Section: Telegram ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.932z"/>
          </svg>
          <h2 className="text-sm font-semibold text-text-primary tracking-wide">
            Telegram
          </h2>
        </div>

        {/* Routing explanation */}
        <div className="mb-5 p-3 rounded border border-surface-border bg-surface-raised/50 text-xs text-text-secondary leading-relaxed space-y-1">
          <p>
            <span className="text-amber-400 font-semibold">Routing rule:</span>{' '}
            if an alert or strategy name contains <code className="text-blue-300 bg-surface-border/60 px-1 rounded">test</code>{' '}
            (case-insensitive) the message goes to <span className="text-text-primary font-medium">Personal</span> chat IDs.
            All other signals go to <span className="text-text-primary font-medium">Group</span> chat IDs.
          </p>
          <p>
            Bot token stays in{' '}
            <code className="text-amber-400 bg-surface-border/40 px-1 rounded">TELEGRAM_BOT_TOKEN</code>{' '}
            in <code className="text-amber-400 bg-surface-border/40 px-1 rounded">.env.local</code>.
          </p>
        </div>

        <div className="flex flex-col gap-6">

          {/* Personal chat IDs */}
          <ChatIdField
            label="Personal Chat IDs"
            badge="test signals"
            badgeColor="text-amber-400 border-amber-400/30 bg-amber-400/5"
            hint='Receives alerts whose name contains "test". One chat ID per line.'
            value={personalIds}
            onChange={setPersonalIds}
            placeholder={'123456789\n987654321'}
          />

          {/* Group chat IDs */}
          <ChatIdField
            label="Group Chat IDs"
            badge="live signals"
            badgeColor="text-emerald-400 border-emerald-400/30 bg-emerald-400/5"
            hint="Receives all other alerts. One chat ID per line. Use negative IDs for group chats/channels."
            value={groupIds}
            onChange={setGroupIds}
            placeholder={'-1001234567890\n-1009876543210'}
          />

        </div>
      </section>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2 border-t border-surface-border">
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`
            px-4 py-1.5 rounded text-xs font-semibold transition-all
            ${saveState === 'saving'
              ? 'bg-blue-800/50 text-blue-300 cursor-wait'
              : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'}
          `}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save settings'}
        </button>

        {saveState === 'saved' && (
          <span className="text-xs text-emerald-400 font-mono">✓ Saved</span>
        )}
        {saveState === 'error' && (
          <span className="text-xs text-red-400 font-mono">✗ {errorMsg}</span>
        )}
        {saveState === 'idle' && isDirty && (
          <span className="text-xs text-text-muted">Unsaved changes</span>
        )}
      </div>

    </div>
  );
}

// ── ChatIdField ───────────────────────────────────────────────────────────────

interface ChatIdFieldProps {
  label:       string;
  badge:       string;
  badgeColor:  string;
  hint:        string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
}

function ChatIdField({ label, badge, badgeColor, hint, value, onChange, placeholder }: ChatIdFieldProps) {
  // Count non-empty lines for the "N IDs" indicator
  const count = value.split('\n').map((s) => s.trim()).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-text-primary">{label}</label>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${badgeColor}`}>
          {badge}
        </span>
        {count > 0 && (
          <span className="text-[10px] text-text-muted font-mono ml-auto">
            {count} {count === 1 ? 'ID' : 'IDs'}
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        rows={3}
        className="
          font-mono text-xs text-slate-100
          bg-[#0f1629] border border-slate-700
          rounded px-3 py-2 w-full max-w-xs resize-y
          placeholder:text-slate-500
          focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500
          transition-colors leading-relaxed
        "
      />
    </div>
  );
}
