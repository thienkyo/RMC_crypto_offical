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
import { pushStrategyToDb, pushManyStrategiesToDb } from '@/lib/strategy/api';
import { useBacktest }          from '@/hooks/useBacktest';
import { TIMEFRAMES }           from '@/types/market';
import { TF_TO_MS }             from '@/lib/exchange/binance';
import type {
  Strategy,
  StrategyAction,
  RiskManagement,
  ConditionGroup,
} from '@/types/strategy';

function makeGroup(operator: 'or' | 'and' = 'or'): ConditionGroup {
  return {
    id:         `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label:      '',
    conditions: [],
    operator,
    // conditionOperator left undefined → smart default kicks in
  };
}

interface Props {
  strategy: Strategy;
}

export function StrategyForm({ strategy: initial }: Props) {
  const [draft, setDraft]               = useState<Strategy>(initial);
  const [error, setError]               = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [groupTopicToast, setGroupTopicToast] = useState<string | null>(null);

  const strategies           = useStrategyStore((s) => s.strategies);
  const upsertStrategy       = useStrategyStore((s) => s.upsertStrategy);
  const duplicateStrategy    = useStrategyStore((s) => s.duplicateStrategy);
  const cloneFromTemplate    = useStrategyStore((s) => s.cloneFromTemplate);
  const setGroupTelegramTopic = useStrategyStore((s) => s.setGroupTelegramTopic);
  const isBacktesting        = useStrategyStore((s) => s.isBacktesting);
  const { runBacktestForStrategy } = useBacktest();

  const siblingStrategies = strategies.filter(
    (s) => !s.isTemplate && s.symbol === draft.symbol && s.id !== draft.id
  );

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

  /** DB-first save: push to DB, then update the local store on success. */
  async function handleSave() {
    if (!draft.name.trim()) {
      setError('Strategy name is required.');
      return;
    }
    setError(null);
    setSaving(true);
    const saved = { ...draft, version: draft.version + 1 };
    if (saved.telegramTopic?.enabled && !saved.telegramTopic.name.trim()) {
      saved.telegramTopic = { ...saved.telegramTopic, name: saved.symbol };
    }
    try {
      await pushStrategyToDb(saved);
      upsertStrategy(saved);
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : 'DB unreachable'}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleBacktest() {
    if (!draft.name.trim()) {
      setError('Save the strategy before running a backtest.');
      return;
    }
    setError(null);
    setSaving(true);
    // DB-first save so results are associated with the persisted state
    const saved = { ...draft, version: draft.version + 1 };
    if (saved.telegramTopic?.enabled && !saved.telegramTopic.name.trim()) {
      saved.telegramTopic = { ...saved.telegramTopic, name: saved.symbol };
    }
    try {
      await pushStrategyToDb(saved);
      upsertStrategy(saved);
      setDraft(saved);
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : 'DB unreachable'}`);
      setSaving(false);
      return;
    }
    setSaving(false);

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
            {draft.isMtf && (
              <span className="text-[10px] font-mono font-semibold px-1.5 py-px rounded
                               bg-cyan-500/15 text-cyan-400 tracking-wider">
                MTF
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
                onChange={(e) => {
                  const newTf = e.target.value as Strategy['timeframe'];
                  patch('timeframe', newTf);
                  if (draft.isMtf) {
                    const baseMs = TF_TO_MS[newTf];
                    const cleanConditions = (groups: ConditionGroup[]) => groups.map((g) => ({
                      ...g,
                      conditions: g.conditions.map((c) => {
                        if (c.timeframe && TF_TO_MS[c.timeframe] <= baseMs) {
                          return { ...c, timeframe: undefined };
                        }
                        return c;
                      })
                    }));
                    patch('entryConditions', cleanConditions(draft.entryConditions));
                    patch('exitConditions', cleanConditions(draft.exitConditions));
                  }
                }}
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
        <section className="space-y-2.5">
          <div>
            <h3 className="section-heading flex items-center gap-2 flex-wrap">
              <span>Entry Conditions</span>
              <span className="text-text-muted font-normal text-xs lowercase">
                (any OR group fires · all AND groups must fire)
              </span>
            </h3>
          </div>

          <div className="pl-3 sm:pl-4 border-l-2 border-surface-border/70 ml-1 sm:ml-1.5 space-y-3 pt-0.5">
            {draft.entryConditions.length === 0 && (
              <p className="text-xs text-text-muted italic py-1">No entry conditions — add a group below.</p>
            )}

            {draft.entryConditions.map((group, i) => (
              <div key={group.id} className="relative">
                {/* Inter-group connector pill */}
                {i > 0 && (
                  <div className="flex items-center gap-2 py-2 -ml-3 sm:-ml-4 pl-3 sm:pl-4">
                    <div className="w-3 sm:w-4 h-px bg-surface-border" />
                    <span className={`text-[10px] font-mono font-bold tracking-wide px-2.5 py-0.5 rounded-full border shadow-xs flex items-center gap-1.5 ${
                      (group.operator ?? 'or') === 'or'
                        ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                        : 'text-amber-400 border-amber-500/40 bg-amber-500/10'
                    }`}>
                      <span>{(group.operator ?? 'or') === 'or' ? 'OR' : 'AND'}</span>
                      <span className="text-[9px] font-normal opacity-80">
                        {(group.operator ?? 'or') === 'or' ? '(alternative setup)' : '(required filter)'}
                      </span>
                    </span>
                    <div className="h-px flex-1 bg-surface-border/50" />
                  </div>
                )}
                <ConditionGroupEditor
                  group={group}
                  groupIndex={i}
                  totalGroups={draft.entryConditions.length}
                  onChange={(updated) => updateEntryGroup(i, updated)}
                  onRemoveGroup={() => removeEntryGroup(i)}
                  isMultiTf={draft.isMtf === true}
                  baseTimeframe={draft.timeframe}
                />
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => patch('entryConditions', [...draft.entryConditions, makeGroup('or')])}
                className="btn-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50"
              >
                + Add OR group
              </button>
              <button
                type="button"
                onClick={() => patch('entryConditions', [...draft.entryConditions, makeGroup('and')])}
                className="btn-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50"
              >
                + Add AND group
              </button>
            </div>
          </div>
        </section>

        {/* ── Exit conditions ───────────────────────────────────────────── */}
        <section className="space-y-2.5">
          <div>
            <h3 className="section-heading flex items-center gap-2 flex-wrap">
              <span>Exit Conditions</span>
              <span className="text-text-muted font-normal text-xs lowercase">(leave empty to rely on SL / TP)</span>
            </h3>
          </div>

          <div className="pl-3 sm:pl-4 border-l-2 border-surface-border/70 ml-1 sm:ml-1.5 space-y-3 pt-0.5">
            {draft.exitConditions.length === 0 && (
              <p className="text-xs text-text-muted italic py-1">No exit signal — SL / TP only.</p>
            )}

            {draft.exitConditions.map((group, i) => (
              <div key={group.id} className="relative">
                {i > 0 && (
                  <div className="flex items-center gap-2 py-2 -ml-3 sm:-ml-4 pl-3 sm:pl-4">
                    <div className="w-3 sm:w-4 h-px bg-surface-border" />
                    <span className={`text-[10px] font-mono font-bold tracking-wide px-2.5 py-0.5 rounded-full border shadow-xs flex items-center gap-1.5 ${
                      (group.operator ?? 'or') === 'or'
                        ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
                        : 'text-amber-400 border-amber-500/40 bg-amber-500/10'
                    }`}>
                      <span>{(group.operator ?? 'or') === 'or' ? 'OR' : 'AND'}</span>
                      <span className="text-[9px] font-normal opacity-80">
                        {(group.operator ?? 'or') === 'or' ? '(alternative setup)' : '(required filter)'}
                      </span>
                    </span>
                    <div className="h-px flex-1 bg-surface-border/50" />
                  </div>
                )}
                <ConditionGroupEditor
                  group={group}
                  groupIndex={i}
                  totalGroups={draft.exitConditions.length}
                  onChange={(updated) => updateExitGroup(i, updated)}
                  onRemoveGroup={() => removeExitGroup(i)}
                  isMultiTf={draft.isMtf === true}
                  baseTimeframe={draft.timeframe}
                />
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => patch('exitConditions', [...draft.exitConditions, makeGroup('or')])}
                className="btn-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/50"
              >
                + Add OR group
              </button>
              <button
                type="button"
                onClick={() => patch('exitConditions', [...draft.exitConditions, makeGroup('and')])}
                className="btn-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50"
              >
                + Add AND group
              </button>
            </div>
          </div>
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
              <>
                <p className="text-xs text-text-muted pl-12 mb-3">
                  Save to sync this strategy to the server. The cron checks every minute
                  and fires when entry conditions are met. Configure{' '}
                  <span className="text-text-primary">Confirm / Lookback</span> per condition above.
                </p>
                <div className="pl-12 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.telegramTopic?.enabled ?? false}
                      onClick={() => {
                        const current = draft.telegramTopic || { enabled: false, name: '' };
                        patch('telegramTopic', { ...current, enabled: !current.enabled });
                      }}
                      className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                        draft.telegramTopic?.enabled ? 'bg-emerald-500' : 'bg-surface-border'
                      }`}
                    >
                      <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${
                        draft.telegramTopic?.enabled ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                    <span className="text-xs text-text-primary">
                      Send to Telegram topic
                    </span>
                  </label>
                  {draft.telegramTopic?.enabled && (
                    <div className="flex flex-col gap-1.5 max-w-[240px]">
                      <span className="text-xs text-text-muted">Topic name</span>
                      <input
                        type="text"
                        placeholder={draft.symbol}
                        value={draft.telegramTopic.name || ''}
                        onChange={(e) => {
                          const name = e.target.value.substring(0, 128);
                          patch('telegramTopic', { ...draft.telegramTopic, enabled: true, name });
                        }}
                        onBlur={(e) => {
                          const name = e.target.value.trim().substring(0, 128);
                          if (name !== draft.telegramTopic?.name) {
                            patch('telegramTopic', { ...draft.telegramTopic, enabled: true, name });
                          }
                        }}
                        className="w-full bg-surface-elevated text-text-primary text-xs px-2 py-1.5 border border-surface-border rounded outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  )}
                  {siblingStrategies.length > 0 && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const enabled = draft.telegramTopic?.enabled ?? false;
                          const name = (draft.telegramTopic?.name || draft.symbol).trim();
                          const topic = { enabled, name };
                          patch('telegramTopic', topic);
                          const updated = setGroupTelegramTopic(draft.symbol, topic);
                          if (updated.length > 0) {
                            pushManyStrategiesToDb(updated).catch((err) =>
                              console.warn('[group-topic-apply] sync failed:', err)
                            );
                          }
                          setGroupTopicToast(
                            enabled
                              ? `Applied topic #${name} to all ${updated.length} ${draft.symbol} strategies!`
                              : `Disabled topic routing for all ${updated.length} ${draft.symbol} strategies!`
                          );
                          setTimeout(() => setGroupTopicToast(null), 3500);
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 text-xs font-mono transition-colors"
                      >
                        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                        </svg>
                        <span>Apply topic to all {siblingStrategies.length + 1} {draft.symbol} strategies</span>
                      </button>
                      {groupTopicToast && (
                        <p className="text-[11px] font-mono text-emerald-400 mt-1">{groupTopicToast}</p>
                      )}
                    </div>
                  )}
                </div>
              </>
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
            disabled={saving}
            className="btn-sm btn-secondary disabled:opacity-60"
          >
            {saving ? 'Saving…' : `Save (v${draft.version + 1})`}
          </button>

          {draft.isTemplate ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const copy = duplicateStrategy(draft.id);
                  if (copy) pushStrategyToDb(copy).catch((err) =>
                    console.warn('[StrategyForm] duplicate DB push failed:', err),
                  );
                }}
                className="btn-sm btn-secondary"
                title="Duplicate as another template"
              >
                ⧉ Duplicate
              </button>
              <button
                type="button"
                onClick={() => {
                  const clone = cloneFromTemplate(draft.id);
                  if (clone) pushStrategyToDb(clone).catch((err) =>
                    console.warn('[StrategyForm] clone DB push failed:', err),
                  );
                }}
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
