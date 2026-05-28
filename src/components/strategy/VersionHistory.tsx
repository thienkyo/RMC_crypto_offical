'use client';

/**
 * VersionHistory — right-panel History tab for the strategy editor.
 *
 * Shows a list of saved versions for the active strategy.
 * Each row supports three actions:
 *   Preview  — read-only expandable view of that snapshot's conditions/settings
 *   Diff     — structured change list between that version and current
 *   Restore  — overwrites current with that snapshot (bumps version number)
 *
 * Also includes a max-versions prune control at the top.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useStrategyVersions, useStrategyVersion } from '@/hooks/useStrategyVersions';
import { diffStrategies, SECTION_LABELS, CHANGE_COLORS } from '@/lib/strategy/diff';
import { useStrategyStore } from '@/store/strategy';
import type { Strategy } from '@/types/strategy';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelMode = 'preview' | 'diff';

interface ActivePanel {
  version: number;
  mode:    PanelMode;
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  strategy: Strategy;
}

export function VersionHistory({ strategy }: Props) {
  const qc            = useQueryClient();
  const upsertStrategy = useStrategyStore((s) => s.upsertStrategy);

  const [maxVersions,  setMaxVersions]  = useState(20);
  const [activePanel,  setActivePanel]  = useState<ActivePanel | null>(null);
  const [pruning,      setPruning]      = useState(false);
  const [restoring,    setRestoring]    = useState<number | null>(null);
  const [feedback,     setFeedback]     = useState<string | null>(null);

  const { data: versions, isLoading, error } = useStrategyVersions(strategy.id);

  function showFeedback(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  }

  function togglePanel(version: number, mode: PanelMode) {
    setActivePanel((prev) =>
      prev?.version === version && prev.mode === mode ? null : { version, mode }
    );
  }

  async function handlePrune() {
    setPruning(true);
    try {
      const res = await fetch(
        `/api/strategies/${strategy.id}/versions?keep=${maxVersions}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { deleted: number; kept: number };
      await qc.invalidateQueries({ queryKey: ['strategy-versions', strategy.id] });
      showFeedback(`Pruned ${data.deleted} old version(s). Keeping ${data.kept}.`);
    } catch (err) {
      showFeedback(`Prune failed: ${String(err)}`);
    } finally {
      setPruning(false);
    }
  }

  async function handleRestore(version: number, definition: Strategy) {
    if (!confirm(
      `Restore to v${version}?\n\nThis will overwrite the current strategy and save as a new version. This cannot be undone.`
    )) return;

    setRestoring(version);
    try {
      const restored: Strategy = {
        ...definition,
        version:   strategy.version + 1,
        updatedAt: Date.now(),
      };
      upsertStrategy(restored);
      // Sync to DB so the restored version is snapshotted
      await fetch('/api/strategies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(restored),
      });
      await qc.invalidateQueries({ queryKey: ['strategy-versions', strategy.id] });
      setActivePanel(null);
      showFeedback(`Restored to v${version} → saved as v${restored.version}.`);
    } catch (err) {
      showFeedback(`Restore failed: ${String(err)}`);
    } finally {
      setRestoring(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-xs animate-pulse">
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400">
        Failed to load version history. Make sure the DB is reachable.
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-text-muted">
        <span className="text-2xl">🕐</span>
        <p className="text-xs">No saved versions yet.</p>
        <p className="text-xs text-text-muted/60">Save the strategy to create a snapshot.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Prune control ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2
                      border-b border-surface-border bg-surface-2/40">
        <span className="text-[10px] text-text-muted font-mono">Keep</span>
        <input
          type="number"
          min={1}
          max={100}
          value={maxVersions}
          onChange={(e) => setMaxVersions(Math.max(1, parseInt(e.target.value, 10) || 20))}
          className="input-xs w-14 text-center font-mono"
        />
        <span className="text-[10px] text-text-muted font-mono">versions</span>
        <button
          type="button"
          onClick={() => { void handlePrune(); }}
          disabled={pruning}
          className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded border
                     border-surface-border text-text-muted
                     hover:border-red-500/40 hover:text-red-400
                     disabled:opacity-40 disabled:cursor-wait transition-colors"
        >
          {pruning ? '…' : 'Prune'}
        </button>
      </div>

      {/* ── Feedback banner ─────────────────────────────────────────── */}
      {feedback && (
        <div className="flex-shrink-0 px-3 py-1.5 text-[11px] font-mono
                        bg-accent/10 text-accent border-b border-accent/20">
          {feedback}
        </div>
      )}

      {/* ── Version list ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {versions.map((v) => {
          const isCurrent    = v.version === strategy.version;
          const isPanelOpen  = activePanel?.version === v.version;
          const isRestoring  = restoring === v.version;

          return (
            <div key={v.version} className="border-b border-surface-border last:border-0">

              {/* ── Row ───────────────────────────────────────────── */}
              <div className={`flex items-center gap-2 px-3 py-2.5 ${
                isCurrent ? 'bg-blue-500/5' : 'hover:bg-surface-2/50'
              } transition-colors`}>

                {/* Version badge */}
                <span className={`text-[10px] font-mono font-semibold flex-shrink-0 w-7 ${
                  isCurrent ? 'text-blue-400' : 'text-text-muted'
                }`}>
                  v{v.version}
                </span>

                {/* Timestamp + name */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-text-secondary truncate">{v.name}</div>
                  <div className="text-[10px] text-text-muted font-mono">
                    {formatDistanceToNow(new Date(v.saved_at), { addSuffix: true })}
                  </div>
                </div>

                {/* Current badge */}
                {isCurrent && (
                  <span className="text-[9px] font-mono font-semibold px-1.5 py-px rounded
                                   bg-blue-500/15 text-blue-400 flex-shrink-0">
                    current
                  </span>
                )}

                {/* Action buttons — hidden for current version */}
                {!isCurrent && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <VersionActionBtn
                      label="Preview"
                      active={isPanelOpen && activePanel?.mode === 'preview'}
                      onClick={() => togglePanel(v.version, 'preview')}
                    />
                    <VersionActionBtn
                      label="Diff"
                      active={isPanelOpen && activePanel?.mode === 'diff'}
                      onClick={() => togglePanel(v.version, 'diff')}
                    />
                    <VersionActionBtn
                      label={isRestoring ? '…' : '↩'}
                      active={false}
                      onClick={() => {
                        // Fetch definition then restore — handled in panel
                        togglePanel(v.version, 'preview');
                      }}
                      title="Open preview then use Restore button"
                    />
                  </div>
                )}
              </div>

              {/* ── Expanded panel ────────────────────────────────── */}
              {isPanelOpen && (
                <VersionPanel
                  strategyId={strategy.id}
                  version={v.version}
                  mode={activePanel!.mode}
                  current={strategy}
                  onRestore={handleRestore}
                  isRestoring={restoring === v.version}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── VersionActionBtn ──────────────────────────────────────────────────────────

function VersionActionBtn({
  label, active, onClick, title,
}: {
  label: string; active: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-surface-border text-text-muted hover:text-text-primary hover:border-text-muted'
      }`}
    >
      {label}
    </button>
  );
}

// ── VersionPanel ──────────────────────────────────────────────────────────────

function VersionPanel({
  strategyId,
  version,
  mode,
  current,
  onRestore,
  isRestoring,
}: {
  strategyId:  string;
  version:     number;
  mode:        PanelMode;
  current:     Strategy;
  onRestore:   (v: number, def: Strategy) => void;
  isRestoring: boolean;
}) {
  const { data, isLoading, error } = useStrategyVersion(strategyId, version);

  if (isLoading) {
    return (
      <div className="px-3 py-3 text-[11px] text-text-muted animate-pulse border-t border-surface-border">
        Loading v{version}…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-3 py-3 text-[11px] text-red-400 border-t border-surface-border">
        Failed to load version.
      </div>
    );
  }

  const def = data.definition;

  return (
    <div className="border-t border-surface-border bg-surface-2/30 p-3 space-y-3">

      {/* Mode toggle + Restore button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['preview', 'diff'] as PanelMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {/* parent toggles via row buttons */}}
              className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                mode === m
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-surface-border text-text-muted'
              }`}
            >
              {m === 'preview' ? 'Preview' : 'Diff vs current'}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={isRestoring}
          onClick={() => onRestore(version, def)}
          className="text-[10px] font-mono px-2.5 py-1 rounded border
                     border-amber-500/40 bg-amber-500/10 text-amber-400
                     hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-wait
                     transition-colors font-semibold"
        >
          {isRestoring ? 'Restoring…' : `↩ Restore v${version}`}
        </button>
      </div>

      {/* Panel content */}
      {mode === 'preview' ? (
        <StrategyPreview definition={def} />
      ) : (
        <StrategyDiff from={def} to={current} />
      )}
    </div>
  );
}

// ── StrategyPreview ───────────────────────────────────────────────────────────

function StrategyPreview({ definition: d }: { definition: Strategy }) {
  return (
    <div className="space-y-2 text-[11px] font-mono">

      {/* Scalars */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-muted">
        <PreviewRow label="Name"        value={d.name} />
        <PreviewRow label="Symbol"      value={d.symbol} />
        <PreviewRow label="Timeframe"   value={d.timeframe} />
        <PreviewRow label="Direction"   value={d.action.type === 'enter_long' ? '▲ Long' : '▼ Short'} />
        <PreviewRow label="Position"    value={`${d.action.positionSizePct}%`} />
        <PreviewRow label="Stop loss"   value={`${d.risk.stopLossPct}%`} />
        <PreviewRow label="Take profit" value={`${d.risk.takeProfitPct}%`} />
      </div>

      {/* Entry conditions */}
      <ConditionGroupsPreview label="Entry" groups={d.entryConditions} />

      {/* Exit conditions */}
      <ConditionGroupsPreview label="Exit" groups={d.exitConditions} />
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary">{value}</span>
    </>
  );
}

function ConditionGroupsPreview({
  label, groups,
}: {
  label: string;
  groups: Strategy['entryConditions'];
}) {
  if (groups.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
        {label} Conditions
      </div>
      <div className="space-y-1">
        {groups.map((g, gi) => (
          <div key={g.id ?? gi} className="rounded border border-surface-border px-2 py-1 space-y-0.5">
            <div className="text-text-muted text-[10px]">
              {g.label || `Group ${gi + 1}`}
              {' · '}
              <span className="text-accent">{g.operator?.toUpperCase() ?? 'OR'} group</span>
            </div>
            {g.conditions.map((c, ci) => (
              <div key={c.id ?? ci} className={`text-[10px] pl-2 ${c.enabled === false ? 'opacity-40 line-through' : 'text-text-secondary'}`}>
                {c.indicatorId.toUpperCase()}[{c.seriesIndex}] {c.operator} {c.value}
                {Object.keys(c.params).length > 0 && (
                  <span className="text-text-muted ml-1">
                    ({Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(', ')})
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StrategyDiff ──────────────────────────────────────────────────────────────

function StrategyDiff({ from, to }: { from: Strategy; to: Strategy }) {
  const { changes, identical } = diffStrategies(from, to);

  if (identical) {
    return (
      <p className="text-[11px] text-text-muted italic">
        No differences — this version is identical to the current one.
      </p>
    );
  }

  // Group changes by section
  const bySection = new Map<string, typeof changes>();
  for (const c of changes) {
    const sec = c.kind === 'scalar' ? c.section : c.section;
    const label = c.kind === 'condition'
      ? (c.section === 'entry' ? 'entry' : 'exit')
      : c.section;
    if (!bySection.has(label)) bySection.set(label, []);
    bySection.get(label)!.push(c);
  }

  return (
    <div className="space-y-2 text-[11px] font-mono">
      <p className="text-[10px] text-text-muted">
        Changes from v{from.version} → current (v{to.version})
      </p>

      {Array.from(bySection.entries()).map(([sec, items]) => (
        <div key={sec}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
            {SECTION_LABELS[sec as keyof typeof SECTION_LABELS] ?? sec}
          </div>
          <div className="space-y-0.5">
            {items.map((c, i) => (
              <div key={i} className="flex items-start gap-2 pl-2">
                {c.kind === 'scalar' ? (
                  <>
                    <span className="text-amber-400 flex-shrink-0">~</span>
                    <span className="text-text-muted">{c.field}:</span>
                    <span className="text-red-400 line-through">{c.from}</span>
                    <span className="text-text-muted">→</span>
                    <span className="text-emerald-400">{c.to}</span>
                  </>
                ) : (
                  <>
                    <span className={`flex-shrink-0 ${CHANGE_COLORS[c.change]}`}>
                      {c.change.startsWith('added') ? '+' : c.change.startsWith('removed') ? '−' : '~'}
                    </span>
                    <span className={CHANGE_COLORS[c.change]}>{c.detail}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
