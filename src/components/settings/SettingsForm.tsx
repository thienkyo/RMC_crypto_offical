'use client';

import { useState, useTransition } from 'react';
import type { AppSettings } from '@/app/api/settings/route';
import { LATEST_MODELS, costToMaxTokens, maxTokensToCost } from '@/lib/ai/evaluator/types';

interface Props {
  initial: AppSettings;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Settings form — fully client-side so we get instant feedback.
 * Submits to POST /api/settings via fetch; no full page reload.
 */
export function SettingsForm({ initial }: Props) {
  // Telegram Settings
  const [personalIds, setPersonalIds] = useState(initial.telegram_personal_chat_id ?? '');
  const [groupIds,    setGroupIds]    = useState(initial.telegram_group_chat_id    ?? '');
  const [alertIds,    setAlertIds]    = useState(initial.telegram_alert_chat_id    ?? '');

  // AI Models & Evaluator Settings
  const [geminiApiKey, setGeminiApiKey] = useState(initial.gemini_api_key ?? '');
  const [geminiModel, setGeminiModel]   = useState(initial.gemini_evaluator_model || LATEST_MODELS.gemini.default);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [anthropicApiKey, setAnthropicApiKey] = useState(initial.anthropic_api_key ?? '');
  const [anthropicModel, setAnthropicModel]   = useState(initial.anthropic_evaluator_model || LATEST_MODELS.claude.default);
  const [showClaudeKey, setShowClaudeKey]     = useState(false);

  const [openaiApiKey, setOpenaiApiKey] = useState(initial.openai_api_key ?? '');
  const [openaiModel, setOpenaiModel]   = useState(initial.openai_evaluator_model || LATEST_MODELS.chatgpt.default);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);

  // Money-based limits instead of raw token counts
  const initialCost = initial.ai_evaluator_max_cost_usd
    ? initial.ai_evaluator_max_cost_usd
    : initial.ai_evaluator_max_tokens
    ? maxTokensToCost(parseInt(initial.ai_evaluator_max_tokens, 10)).toFixed(3)
    : '0.010';

  const [maxCostUsd, setMaxCostUsd] = useState(initialCost);
  const [monthlyBudgetUsd, setMonthlyBudgetUsd] = useState(
    initial.ai_evaluator_monthly_budget_usd ?? '10.00',
  );

  const [gatekeeperEnabled, setGatekeeperEnabled] = useState(
    initial.enable_ai_signal_gatekeeper === null
      ? true
      : initial.enable_ai_signal_gatekeeper === 'true' || initial.enable_ai_signal_gatekeeper === '1',
  );

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg,  setErrorMsg]  = useState('');
  const [, startTransition]       = useTransition();

  const isDirty =
    personalIds !== (initial.telegram_personal_chat_id ?? '') ||
    groupIds    !== (initial.telegram_group_chat_id    ?? '') ||
    alertIds    !== (initial.telegram_alert_chat_id    ?? '') ||
    geminiApiKey !== (initial.gemini_api_key ?? '') ||
    geminiModel  !== (initial.gemini_evaluator_model || LATEST_MODELS.gemini.default) ||
    anthropicApiKey !== (initial.anthropic_api_key ?? '') ||
    anthropicModel  !== (initial.anthropic_evaluator_model || LATEST_MODELS.claude.default) ||
    openaiApiKey !== (initial.openai_api_key ?? '') ||
    openaiModel  !== (initial.openai_evaluator_model || LATEST_MODELS.chatgpt.default) ||
    maxCostUsd !== initialCost ||
    monthlyBudgetUsd !== (initial.ai_evaluator_monthly_budget_usd ?? '10.00') ||
    gatekeeperEnabled !== (initial.enable_ai_signal_gatekeeper === null ? true : initial.enable_ai_signal_gatekeeper === 'true' || initial.enable_ai_signal_gatekeeper === '1');

  async function handleSave() {
    setSaveState('saving');
    setErrorMsg('');

    const parsedCost = parseFloat(maxCostUsd) || 0.01;
    const computedTokens = costToMaxTokens(parsedCost);

    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_personal_chat_id: personalIds,
          telegram_group_chat_id:    groupIds,
          telegram_alert_chat_id:    alertIds,
          gemini_api_key:            geminiApiKey.trim() || null,
          gemini_evaluator_model:    geminiModel,
          anthropic_api_key:         anthropicApiKey.trim() || null,
          anthropic_evaluator_model: anthropicModel,
          openai_api_key:            openaiApiKey.trim() || null,
          openai_evaluator_model:    openaiModel,
          ai_evaluator_max_cost_usd: maxCostUsd.trim() || '0.01',
          ai_evaluator_monthly_budget_usd: monthlyBudgetUsd.trim() || '10.00',
          ai_evaluator_max_tokens:   String(computedTokens),
          enable_ai_signal_gatekeeper: gatekeeperEnabled ? 'true' : 'false',
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
    <div className="flex flex-col gap-10 max-w-2xl">

      {/* ── Section 1: AI Models & Order Evaluator ────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-accent font-mono">✦</span>
          <h2 className="text-sm font-semibold text-text-primary tracking-wide">
            AI Models &amp; Order Evaluator
          </h2>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
            Latest 2025/2026 Models
          </span>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed mb-4">
          Configure API keys and choose the exact model versions used by the AI Order Evaluator and Telegram Signal Gatekeeper.
          Keys saved here take effect immediately in database without server restarts (or leave empty to use <code className="text-amber-400 bg-surface-border/40 px-1 rounded">.env.local</code>).
        </p>

        <div className="flex flex-col gap-5">

          {/* Google Gemini Card */}
          <div className="p-4 rounded-lg border border-surface-border bg-surface-2/60 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                <span className="text-xs font-semibold text-text-primary">Google Gemini</span>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/20">
                Recommended / High-Speed
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ModelSelectField
                label="Active Model"
                value={geminiModel}
                onChange={setGeminiModel}
                options={LATEST_MODELS.gemini.options}
                accentBorder="focus:border-cyan-400"
                placeholder="e.g. gemini-3.8-flash"
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-mono text-text-muted">API Key</label>
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showGeminiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIzaSy... or blank for .env.local"
                  spellCheck={false}
                  className="w-full bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>
          </div>

          {/* Anthropic Claude Card */}
          <div className="p-4 rounded-lg border border-surface-border bg-surface-2/60 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                <span className="text-xs font-semibold text-text-primary">Anthropic Claude</span>
              </div>
              <span className="text-[10px] font-mono text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                Claude Opus 5.1 &amp; Sonnet
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ModelSelectField
                label="Active Model"
                value={anthropicModel}
                onChange={setAnthropicModel}
                options={LATEST_MODELS.claude.options}
                accentBorder="focus:border-amber-400"
                placeholder="e.g. claude-opus-5-1"
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-mono text-text-muted">API Key</label>
                  <button
                    type="button"
                    onClick={() => setShowClaudeKey(!showClaudeKey)}
                    className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showClaudeKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  type={showClaudeKey ? 'text' : 'password'}
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-... or blank for .env.local"
                  spellCheck={false}
                  className="w-full bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>
          </div>

          {/* OpenAI ChatGPT Card */}
          <div className="p-4 rounded-lg border border-surface-border bg-surface-2/60 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span className="text-xs font-semibold text-text-primary">OpenAI (ChatGPT)</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                ChatGPT 5.1 &amp; GPT-6
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ModelSelectField
                label="Active Model"
                value={openaiModel}
                onChange={setOpenaiModel}
                options={LATEST_MODELS.chatgpt.options}
                accentBorder="focus:border-emerald-400"
                placeholder="e.g. gpt-5.1"
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-mono text-text-muted">API Key</label>
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                    className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors"
                  >
                    {showOpenaiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-proj-... or blank for .env.local"
                  spellCheck={false}
                  className="w-full bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>
          </div>

          {/* Spending & Budget Limits (USD $) */}
          <div className="p-4 rounded-lg border border-surface-border bg-surface-raised/40 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-mono font-bold">$</span>
              <h3 className="text-xs font-semibold text-text-primary">
                AI Spending Limits (USD $)
              </h3>
            </div>

            {/* Per-Evaluation Cost Limit */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-1">
                <div>
                  <label className="text-xs font-semibold text-text-primary block">
                    Max Spend per Evaluation
                  </label>
                  <p className="text-[11px] text-text-secondary">
                    Sets maximum cost per order check. Automatically calculates output length.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 self-start md:self-auto">
                  <span className="text-xs font-mono text-text-muted">$</span>
                  <input
                    type="number"
                    min="0.001"
                    max="1.000"
                    step="0.005"
                    value={maxCostUsd}
                    onChange={(e) => setMaxCostUsd(e.target.value)}
                    className="w-24 bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-400 text-right"
                  />
                  <span className="text-[11px] font-mono text-text-muted">USD</span>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setMaxCostUsd('0.005')}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                    maxCostUsd === '0.005'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-surface border-slate-700 text-text-muted hover:text-text-primary'
                  }`}
                >
                  ⚡ $0.005 (Economy · ~500 tokens)
                </button>
                <button
                  type="button"
                  onClick={() => setMaxCostUsd('0.010')}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                    maxCostUsd === '0.010' || maxCostUsd === '0.01'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-surface border-slate-700 text-text-muted hover:text-text-primary'
                  }`}
                >
                  ⚖️ $0.010 (Standard · ~1k tokens)
                </button>
                <button
                  type="button"
                  onClick={() => setMaxCostUsd('0.020')}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                    maxCostUsd === '0.020' || maxCostUsd === '0.02'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-surface border-slate-700 text-text-muted hover:text-text-primary'
                  }`}
                >
                  🧠 $0.020 (In-depth · ~2k tokens)
                </button>
                <button
                  type="button"
                  onClick={() => setMaxCostUsd('0.050')}
                  className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                    maxCostUsd === '0.050' || maxCostUsd === '0.05'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-surface border-slate-700 text-text-muted hover:text-text-primary'
                  }`}
                >
                  🔬 $0.050 (Max · ~5k tokens)
                </button>
              </div>

              {/* Dynamic conversion explanation */}
              <div className="mt-1 p-2 rounded bg-surface/50 border border-surface-border text-[11px] text-text-secondary flex items-center justify-between">
                <span>
                  Estimated volume: <strong className="text-text-primary">100 trade evaluations ≈ ${(Number(maxCostUsd || '0.01') * 100).toFixed(2)}</strong>
                </span>
                <span className="font-mono text-emerald-400">
                  ~{costToMaxTokens(parseFloat(maxCostUsd) || 0.01).toLocaleString()} output tokens
                </span>
              </div>
            </div>

            {/* Monthly Safety Budget */}
            <div className="pt-3 border-t border-surface-border/60 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <label className="text-xs font-semibold text-text-primary block">
                  Monthly AI Safety Budget
                </label>
                <p className="text-[11px] text-text-secondary">
                  Hard safety ceiling: Signal gatekeeper auto-pauses when reached.
                </p>
              </div>

              <div className="flex items-center gap-1.5 self-start md:self-auto">
                <span className="text-xs font-mono text-text-muted">$</span>
                <input
                  type="number"
                  min="1"
                  max="500"
                  step="1"
                  value={monthlyBudgetUsd}
                  onChange={(e) => setMonthlyBudgetUsd(e.target.value)}
                  className="w-24 bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-400 text-right"
                />
                <span className="text-[11px] font-mono text-text-muted">/ month</span>
              </div>
            </div>

            {/* Automated Signal Gatekeeper Toggle */}
            <div className="pt-3 border-t border-surface-border/60 flex items-start gap-3">
              <input
                type="checkbox"
                id="gatekeeper_toggle"
                checked={gatekeeperEnabled}
                onChange={(e) => setGatekeeperEnabled(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 text-blue-500 focus:ring-blue-500 bg-[#0f1629] cursor-pointer"
              />
              <label htmlFor="gatekeeper_toggle" className="cursor-pointer">
                <span className="text-xs font-semibold text-text-primary block">
                  Automatic AI Signal Gatekeeper for Telegram Alerts
                </span>
                <span className="text-[11px] text-text-secondary leading-relaxed block mt-0.5">
                  When enabled, strategy alerts are automatically analyzed by AI before transmission. A strict PASS 🟢 / CAVEAT 🟡 / REJECT 🔴 verdict and risk factor are attached to the Telegram message.
                </span>
              </label>
            </div>
          </div>

        </div>
      </section>

      {/* ── Section 2: Telegram ────────────────────────────────────────────── */}
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

          {/* Test chat IDs */}
          <ChatIdField
            label="Test Chat IDs"
            badge="test signals"
            badgeColor="text-amber-400 border-amber-400/30 bg-amber-400/5"
            hint='Receives any alert or strategy signal whose name contains "test" (case-insensitive). Accepts private and group chat IDs. One per line.'
            value={personalIds}
            onChange={setPersonalIds}
            placeholder={'123456789\n-1001234567890'}
          />

          {/* Signal chat IDs */}
          <ChatIdField
            label="Signal Chat IDs"
            badge="strategy signals"
            badgeColor="text-emerald-400 border-emerald-400/30 bg-emerald-400/5"
            hint="Receives strategy entry signals (non-test). Accepts private and group chat IDs. One per line."
            value={groupIds}
            onChange={setGroupIds}
            placeholder={'123456789\n-1001234567890'}
          />

          {/* Alert chat IDs */}
          <ChatIdField
            label="Alert Chat IDs"
            badge="indicator alerts"
            badgeColor="text-blue-400 border-blue-400/30 bg-blue-400/5"
            hint="Receives indicator-based alerts (price, RSI, etc.). Accepts private and group chat IDs. One per line."
            value={alertIds}
            onChange={setAlertIds}
            placeholder={'123456789\n-1001234567890'}
          />

        </div>
      </section>

      {/* ── Save bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-4 border-t border-surface-border sticky bottom-4 bg-surface/90 backdrop-blur-sm p-3 rounded-lg border">
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`
            px-5 py-2 rounded text-xs font-semibold transition-all shadow
            ${saveState === 'saving'
              ? 'bg-blue-800/50 text-blue-300 cursor-wait'
              : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'}
          `}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save all settings'}
        </button>

        {saveState === 'saved' && (
          <span className="text-xs text-emerald-400 font-mono font-bold">✓ Settings saved successfully</span>
        )}
        {saveState === 'error' && (
          <span className="text-xs text-red-400 font-mono font-bold">✗ {errorMsg}</span>
        )}
        {saveState === 'idle' && isDirty && (
          <span className="text-xs text-amber-400 font-mono">● Unsaved changes</span>
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

// ── ModelSelectField ──────────────────────────────────────────────────────────

interface ModelSelectProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: readonly { readonly id: string; readonly label: string }[];
  accentBorder: string;
  placeholder: string;
}

function ModelSelectField({
  label,
  value,
  onChange,
  options,
  accentBorder,
  placeholder,
}: ModelSelectProps) {
  const isPreset = options.some((o) => o.id === value);
  const [isCustom, setIsCustom] = useState(!isPreset);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-mono text-text-muted">{label}</label>
        <button
          type="button"
          onClick={() => {
            const nextCustom = !isCustom;
            setIsCustom(nextCustom);
            if (!nextCustom && !isPreset) {
              onChange(options[0]?.id ?? '');
            }
          }}
          className="text-[10px] font-mono text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          {isCustom ? '← Presets' : '✎ Custom ID'}
        </button>
      </div>

      {isCustom ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={`w-full bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none ${accentBorder}`}
        />
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setIsCustom(true);
            } else {
              onChange(e.target.value);
            }
          }}
          className={`w-full bg-[#0f1629] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none ${accentBorder}`}
        >
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
          <option value="__custom__">Custom Model ID…</option>
        </select>
      )}
    </div>
  );
}
