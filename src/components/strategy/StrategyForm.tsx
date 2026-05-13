'use client';

/**
 * StrategyForm — the main editor for a single strategy.
 *
 * Sections:
 *  1. Metadata  — name, symbol, timeframe
 *  2. Entry conditions
 *  3. Exit conditions
 *  4. Action & risk
 *  5. Save / Run Backtest buttons
 */

import { useState } from 'react';
import { ConditionGroupEditor } from './ConditionGroupEditor';
import { ActionEditor }         from './ActionEditor';
import { useStrategyStore }     from '@/store/strategy';
import { useBacktest }          from '@/hooks/useBacktest';
import { TIMEFRAMES }           from '@/types/market';
import type {
  Strategy,
  StrategyAction,
  RiskManagement,
  ConditionGroup,
} from '@/types/strategy';

function makeGroup(): ConditionGroup {
  return {
    id:         `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label:      '',
    conditions: [],
  };
}

interface Props {
  strategy: Strategy;
}

export function StrategyForm({ strategy: initial }: Props) {
  const [draft, setDraft]     = useState<Strategy>(initial);
  const [error, setError]     = useState<string | null>(null);

  const upsertStrategy       = useStrategyStore((s) => s.upsertStrategy);
  const duplicateStrategy    = useStrategyStore((s) => s.duplicateStrategy);
  const cloneFromTemplate    = useStrategyStore((s) => s.cloneFromTemplate);
  const isBacktesting        = useStrategyStore((s) => s.isBacktesting);
  const { runBacktestForStrategy } = useBacktest();

  // Re-sync draft if a different strategy is selected
  // (parent re-mounts this component with a new key when activeStrategyId changes)

  function patch<K extends keyof Strategy>(key: K, value: Strategy[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function updateEntryGroup(index: number, updated: ConditionGroup) {
    const next = [...draft.entryConditions];
    next[index] = updated;
    patch('entryConditions', next);
  }

  function removeEntryGroup(index: number) {
    patch('entryConditions', draft.entryConditions.filter((_, i) => i !== index));
  }

  function updateExitGroup(index: number, updated: ConditionGroup) {
    const next = [...draft.exitConditions];
    next[index] = updated;
    patch('exitConditions', next);
  }

  function removeExitGroup(index: number) {
    patch('exitConditions', draft.exitConditions.filter((_, i) => i !== index));
  }

  function handleActionChange(action: StrategyAction, risk: RiskManagement) {
    setDraft((d) => ({ ...d, action, risk }));
  }

  /** Persist to Zustand + fire-and-forget DB sync for cron access. */
  function syncToDb(saved: typeof draft) {
    fetch('/api/strategies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(saved),
    }).catch((err) => console.warn('[StrategyForm] DB sync failed:', err));
  }

  function handleSave() {
    if (!draft.name.trim()) {
      setError('Strategy name is required.');
      return;
    }
    setError(null);
    const saved = { ...draft, version: draft.version + 1 };
    upsertStrategy(saved);
    syncToDb(saved);
  }

  async function handleBacktest() {
    if (!draft.name.trim()) {
      setError('Save the strategy before running a backtest.');
      return;
    }
    setError(null);
    // Save first so results are associated with the current state
    const saved = { ...draft, version: draft.version + 1 };
    upsertStrategy(saved);
    setDraft(saved);
    syncToDb(saved);

    try {
      await runBacktestForStrategy(saved);
    } catch {
      setError('Backtest failed — check the console for details.');
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-6">

        {/* ── Metadata ──────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="section-heading flex items-center gap-2">
            {draft.isTemplate ? 'Template' : 'Strategy'}
            {draft.isTemplate && (
              <span className="text-[10px] font-mono font-semibold px-1.5 py-px rounded
                               bg-violet-500/15 text-violet-400 tracking-wider">
                TEMPLATE
              </span>
            )}
            <span className={`text-[10px] font-mono font-semibold px-1.5 py-px rounded ${
              draft.action.type === 'enter_long'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
            }`}>
              {draft.action.type === 'enter_long' ? '▲ Bullish' : '▼ Bearish'}
            </span>
          </h3>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1">
              <span className="field-label">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => patch('name', e.target.value)}
                className="input-sm w-48"
                placeholder="My RSI Strategy"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="field-label">Symbol</span>
              <input
                type="text"
                value={draft.symbol}
                onChange={(e) => patch('symbol', e.target.value.toUpperCase())}
                className="input-sm w-28 font-mono"
                placeholder="BTCUSDT"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="field-label">Timeframe</span>
              <select
                value={draft.timeframe}
                onChange={(e) => patch('timeframe', e.target.value as Strategy['timeframe'])}
                className="select-sm"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="field-label">
              Telegram name{' '}
              <span className="text-text-muted font-normal">(optional — shown in alert messages instead of Name)</span>
            </span>
            <input
              type="text"
              value={draft.longName ?? ''}
              onChange={(e) => patch('longName', e.target.value)}
              className="input-sm w-full"
              placeholder="e.g. RSI oversold + EMA crossover — high confidence"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="field-label">Description (optional)</span>
            <textarea
              value={draft.description}
              onChange={(e) => patch('description', e.target.value)}
              rows={2}
              className="input-sm w-full resize-none"
              placeholder="What does this strategy do?"
            />
          </label>
        </section>

        {/* ── Entry conditions ──────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="section-heading">
            Entry Conditions
            <span className="text-text-muted font-normal text-xs ml-2">(paper trade opens when any group fires)</span>
          </h3>

          {draft.entryConditions.length === 0 && (
            <p className="text-xs text-text-muted italic">No entry conditions — add a group.</p>
          )}
          {draft.entryConditions.map((group, i) => (
            <ConditionGroupEditor
              key={group.id}
              group={group}
              groupIndex={i}
              totalGroups={draft.entryConditions.length}
              onChange={(updated) => updateEntryGroup(i, updated)}
              onRemoveGroup={() => removeEntryGroup(i)}
            />
          ))}
          <button
            type="button"
            onClick={() => patch('entryConditions', [...draft.entryConditions, makeGroup()])}
            className="btn-xs"
          >
            + Add OR group
          </button>
        </section>

        {/* ── Exit conditions ───────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="section-heading">
            Exit Conditions
            <span className="text-text-muted font-normal text-xs ml-2">(leave empty to rely on SL / TP)</span>
          </h3>

          {draft.exitConditions.length === 0 && (
            <p className="text-xs text-text-muted italic">No exit signal — SL / TP only.</p>
          )}
          {draft.exitConditions.map((group, i) => (
            <ConditionGroupEditor
              key={group.id}
              group={group}
              groupIndex={i}
              totalGroups={draft.exitConditions.length}
              onChange={(updated) => updateExitGroup(i, updated)}
              onRemoveGroup={() => removeExitGroup(i)}
            />
          ))}
          <button
            type="button"
            onClick={() => patch('exitConditions', [...draft.exitConditions, makeGroup()])}
            className="btn-xs"
          >
            + Add OR group
          </button>
        </section>

        {/* ── Action & risk ─────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h3 className="section-heading">Action & Risk</h3>
          <ActionEditor
            action={draft.action}
            risk={draft.risk}
            onChange={handleActionChange}
          />
        </section>

        {/* ── Notifications (hidden for templates) ─────────────────────── */}
        {!draft.isTemplate && (
          <section className="space-y-2">
            <h3 className="section-heading">Notifications</h3>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={draft.notifyOnSignal ?? false}
                onClick={() => patch('notifyOnSignal', !(draft.notifyOnSignal ?? false))}
                className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                  draft.notifyOnSignal ? 'bg-emerald-500' : 'bg-surface-border'
                }`}
              >
                <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${
                  draft.notifyOnSignal ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <span className="text-xs text-text-primary">
                Notify on Telegram when entry signal fires
              </span>
            </label>
            {draft.notifyOnSignal && (
              <p className="text-xs text-text-muted pl-12">
                Save to sync this strategy to the server. The cron checks every minute
                and fires when entry conditions are met. Configure{' '}
                <span className="text-text-primary">Confirm / Lookback</span> per condition above.
              </p>
            )}
          </section>
        )}

        {/* ── Error ─────────────────────────────────────────────────────── */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pb-4 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            className="btn-sm btn-secondary"
          >
            Save (v{draft.version + 1})
          </button>

          {draft.isTemplate ? (
            <>
              <button
                type="button"
                onClick={() => duplicateStrategy(draft.id)}
                className="btn-sm btn-secondary"
                title="Duplicate as another template"
              >
                ⧉ Duplicate
              </button>
              <button
                type="button"
                onClick={() => cloneFromTemplate(draft.id)}
                className="btn-sm btn-primary"
                title="Clone as a working strategy"
              >
                ⎘ Clone as Strategy
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleBacktest}
              disabled={isBacktesting}
              className="btn-sm btn-primary"
            >
              {isBacktesting ? 'Running…' : '▶ Run Backtest'}
            </button>
          )}

          <span className="text-xs text-text-muted">
            v{draft.version} · {new Date(draft.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
}
