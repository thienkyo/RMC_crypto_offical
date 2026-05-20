'use client';

/**
 * SignalHistory — shows all cron-fired signals for the active strategy.
 *
 * Metrics bar: total, open, wins, losses, win rate, avg win/loss, total P&L.
 * Signal list: each row shows signal entry price + actual buy/exit prices.
 *   - "record result" expands two price inputs (buy price + exit price)
 *   - P&L % is auto-calculated from the two prices server-side
 *   - Saving only the buy price marks the trade as "in trade" (open)
 *   - Saving both prices computes and displays realised P&L
 */

import { useState, useEffect, useCallback } from 'react';
import type { StrategySignalRow, ConditionSnapshotGroup } from '@/lib/strategy/signalMetrics';
import { computeSignalMetrics }  from '@/lib/strategy/signalMetrics';

interface Props {
  strategyId: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1)    return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a price string → number or null. Strips leading $ and commas. */
function parsePrice(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  const v = parseFloat(cleaned);
  return isNaN(v) || v <= 0 ? null : v;
}

/** Compute P&L % from actual buy/exit prices. */
function calcPnl(entry: number, exit: number, direction: 'long' | 'short'): number {
  return direction === 'long'
    ? (exit - entry) / entry * 100
    : (entry - exit) / entry * 100;
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className={`text-sm font-mono font-semibold ${color ?? 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

// ── Conditions snapshot ───────────────────────────────────────────────────────

/** Compact inline display of the frozen condition groups from fire time. */
function ConditionsSnapshot({ groups }: { groups: ConditionSnapshotGroup[] }) {
  function fmtVal(v: number | undefined): string {
    if (v === undefined) return '';
    if (Number.isNaN(v))        return '';
    if (Number.isInteger(v))    return ` = ${v}`;
    if (Math.abs(v) >= 100)     return ` = ${v.toFixed(1)}`;
    if (Math.abs(v) >= 1)       return ` = ${v.toFixed(2)}`;
    return ` = ${v.toFixed(4)}`;
  }

  return (
    <div className="mt-2 pt-2 border-t border-surface-border space-y-1.5">
      {groups.map((g, gi) => (
        <div key={gi}>
          {/* Inter-group separator */}
          {gi > 0 && (
            <div className="flex items-center gap-1.5 my-1">
              <div className="flex-1 h-px bg-surface-border" />
              <span className="text-[9px] font-mono text-text-muted uppercase tracking-wider">
                {g.groupOperator === 'and' ? 'AND filter' : 'OR'}
              </span>
              <div className="flex-1 h-px bg-surface-border" />
            </div>
          )}

          {/* Optional group label */}
          {g.label && (
            <div className="text-[9px] font-mono text-text-muted mb-0.5">[{g.label}]</div>
          )}

          {/* Conditions */}
          <div className="space-y-0.5">
            {g.conditions.map((c, ci) => (
              <div key={ci} className="flex items-baseline gap-1 font-mono text-[10px]">
                {/* Intra-group operator between conditions */}
                {ci > 0 && (
                  <span className="text-text-muted text-[9px] w-5 flex-shrink-0 text-right">
                    {g.conditionOperator.toUpperCase()}
                  </span>
                )}
                {ci === 0 && <span className="w-5 flex-shrink-0" />}

                <span className={`flex-shrink-0 ${c.passed ? 'text-emerald-400' : 'text-text-muted'}`}>
                  {c.passed ? '✓' : '○'}
                </span>
                <span className={`min-w-0 ${c.passed ? 'text-text-secondary' : 'text-text-muted'}`}>
                  {c.label}
                  {c.value !== undefined && (
                    <span className={`${c.passed ? 'text-text-muted' : 'text-text-muted/60'}`}>
                      {fmtVal(c.value)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Signal row ────────────────────────────────────────────────────────────────

interface SignalRowProps {
  signal:   StrategySignalRow;
  onSave:   (id: number, entryPrice: number | null, exitPrice: number | null, direction: 'long' | 'short') => Promise<void>;
  onClear:  (id: number, direction: 'long' | 'short') => Promise<void>;
  onDelete: (id: number) => void;
}

function SignalRow({ signal, onSave, onClear, onDelete }: SignalRowProps) {
  const [editing,        setEditing]        = useState(false);
  const [entryInput,     setEntryInput]     = useState('');
  const [exitInput,      setExitInput]      = useState('');
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState('');
  const [conditionsOpen, setConditionsOpen] = useState(false);

  const hasSnapshot = signal.conditions_snapshot && signal.conditions_snapshot.length > 0;

  const isLong     = signal.direction === 'long';
  const hasBuy     = signal.actual_entry_price !== null;
  const hasSell    = signal.actual_exit_price  !== null;
  const hasOutcome = signal.pnl_pct !== null;
  const isWin      = hasOutcome && signal.pnl_pct! > 0;
  const isLoss     = hasOutcome && signal.pnl_pct! < 0;

  // Live P&L preview while the user is typing both prices
  const previewEntry = parsePrice(entryInput);
  const previewExit  = parsePrice(exitInput);
  const previewPnl   = previewEntry && previewExit
    ? calcPnl(previewEntry, previewExit, signal.direction)
    : null;

  function openEditor() {
    setEntryInput(signal.actual_entry_price ? String(signal.actual_entry_price) : '');
    setExitInput(signal.actual_exit_price   ? String(signal.actual_exit_price)  : '');
    setError('');
    setEditing(true);
  }

  async function handleSubmit() {
    const entry = parsePrice(entryInput);
    const exit  = parsePrice(exitInput);
    if (!entry) { setError('Enter a valid buy price'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(signal.id, entry, exit, signal.direction);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`border-b border-surface-border px-3 py-2.5 text-xs
                     hover:bg-surface-2 transition-colors group
                     ${isWin  ? 'border-l-2 border-l-emerald-500/50' : ''}
                     ${isLoss ? 'border-l-2 border-l-red-500/50'     : ''}
                     ${hasBuy && !hasOutcome ? 'border-l-2 border-l-blue-500/40' : ''}
                     ${!hasBuy && !hasOutcome ? 'border-l-2 border-l-transparent' : ''}`}>

      {/* ── Row top: direction badge + symbol + signal price ── */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[9px] font-mono font-bold px-1.5 py-px rounded flex-shrink-0
                            ${isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span className="font-mono text-text-secondary truncate">
            {signal.symbol} · {signal.timeframe}
          </span>
        </div>
        {/* Signal price (candle close that triggered) */}
        <span className="font-mono text-[10px] text-text-muted flex-shrink-0" title="Signal price (candle close)">
          sig {fmtPrice(signal.entry_price)}
        </span>
      </div>

      {/* ── Row middle: SL/TP + candle time ── */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted mb-2">
        <div className="flex items-center gap-2">
          {signal.stop_loss_pct > 0 && (
            <span>SL <span className="text-red-400">{signal.stop_loss_pct}%</span></span>
          )}
          {signal.take_profit_pct > 0 && (
            <span>TP <span className="text-emerald-400">{signal.take_profit_pct}%</span></span>
          )}
        </div>
        <span className="font-mono">{fmtDate(signal.candle_time)}</span>
      </div>

      {/* ── Actual trade prices (when recorded) ── */}
      {!editing && hasBuy && (
        <div className="flex items-center gap-1.5 mb-2 font-mono text-[11px]">
          <span className="text-text-muted text-[10px]">buy</span>
          <span className="text-text-primary">{fmtPrice(signal.actual_entry_price!)}</span>
          {hasSell ? (
            <>
              <span className="text-text-muted">→</span>
              <span className="text-text-muted text-[10px]">exit</span>
              <span className="text-text-primary">{fmtPrice(signal.actual_exit_price!)}</span>
              <span className={`ml-1 font-semibold text-sm
                               ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-text-muted'}`}>
                {hasOutcome ? fmtPct(signal.pnl_pct!) : '—'}
              </span>
            </>
          ) : (
            <span className="ml-1 text-[10px] text-blue-400 italic">in trade</span>
          )}
        </div>
      )}

      {/* ── Conditions toggle ── */}
      {hasSnapshot && (
        <button
          type="button"
          onClick={() => setConditionsOpen((v) => !v)}
          className="flex items-center gap-1 mb-1.5 text-[10px] font-mono text-text-muted
                     hover:text-text-secondary transition-colors"
        >
          <span>{conditionsOpen ? '▾' : '▸'}</span>
          <span>conditions</span>
          <span className="text-text-muted/50">
            ({signal.conditions_snapshot!.reduce((n, g) => n + g.conditions.length, 0)})
          </span>
        </button>
      )}

      {/* ── Conditions snapshot (expanded) ── */}
      {conditionsOpen && hasSnapshot && (
        <ConditionsSnapshot groups={signal.conditions_snapshot!} />
      )}

      {/* ── Row bottom: action buttons / editor ── */}
      <div className="flex items-center gap-2 mt-1.5">
        {!editing ? (
          <>
            {!hasBuy && (
              <span className="text-[10px] font-mono text-text-muted italic">not opened</span>
            )}

            <button
              type="button"
              onClick={openEditor}
              className={`text-[10px] px-2 py-0.5 rounded border text-text-muted
                         hover:text-text-primary hover:border-accent/50 transition-colors
                         border-surface-border
                         ${hasBuy ? '' : 'ml-auto'}
                         opacity-0 group-hover:opacity-100`}
            >
              {hasBuy ? 'edit prices' : '+ record trade'}
            </button>

            {hasBuy && (
              <button
                type="button"
                onClick={() => onClear(signal.id, signal.direction)}
                className="text-[10px] text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Clear trade record"
              >
                ✕
              </button>
            )}

            {/* Delete button */}
            <button
              type="button"
              onClick={() => { if (confirm('Delete this signal?')) onDelete(signal.id); }}
              className={`text-[10px] text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity
                          ${hasBuy ? '' : 'ml-1'}`}
              title="Delete signal"
            >
              🗑
            </button>
          </>
        ) : (
          /* ── Inline price editor ── */
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex items-center gap-1.5">
              {/* Buy price */}
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[10px] text-text-muted w-7 flex-shrink-0">Buy</span>
                <input
                  type="number"
                  value={entryInput}
                  onChange={(e) => { setEntryInput(e.target.value); setError(''); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  void handleSubmit();
                    if (e.key === 'Escape') { setEditing(false); setError(''); }
                  }}
                  placeholder="e.g. 62840"
                  autoFocus
                  className="flex-1 min-w-0 bg-surface border border-slate-600 rounded px-2 py-1
                             font-mono text-xs text-text-primary placeholder:text-text-muted
                             focus:outline-none focus:border-blue-500"
                />
              </div>
              {/* Exit price */}
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[10px] text-text-muted w-7 flex-shrink-0">Exit</span>
                <input
                  type="number"
                  value={exitInput}
                  onChange={(e) => setExitInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  void handleSubmit();
                    if (e.key === 'Escape') { setEditing(false); setError(''); }
                  }}
                  placeholder="optional"
                  className="flex-1 min-w-0 bg-surface border border-slate-600 rounded px-2 py-1
                             font-mono text-xs text-text-primary placeholder:text-text-muted
                             focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Live P&L preview + action buttons */}
            <div className="flex items-center gap-2">
              {previewPnl !== null && (
                <span className={`font-mono font-semibold text-xs
                                  ${previewPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtPct(previewPnl)}
                </span>
              )}
              {!previewPnl && exitInput === '' && entryInput !== '' && (
                <span className="text-[10px] text-blue-400 italic">will save as "in trade"</span>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                  className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold disabled:opacity-50"
                >
                  {saving ? '…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(''); }}
                  className="px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text-primary text-[10px]"
                >
                  Cancel
                </button>
              </div>
              {error && <span className="text-red-400 text-[10px]">{error}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SignalHistory({ strategyId }: Props) {
  const [signals,    setSignals]    = useState<StrategySignalRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false); // silent refresh — no spinner
  const [fetchErr,   setFetchErr]   = useState('');

  // `silent` = true for post-save refreshes so the list doesn't flash to loading
  const load = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setFetchErr('');
    try {
      const res = await fetch(`/api/strategy-signals?strategyId=${encodeURIComponent(strategyId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StrategySignalRow[];
      setSignals(data);
    } catch (err) {
      setFetchErr(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [strategyId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(
    id:         number,
    entryPrice: number | null,
    exitPrice:  number | null,
    direction:  'long' | 'short',
  ) {
    const res = await fetch('/api/strategy-signals', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, direction, actualEntryPrice: entryPrice, actualExitPrice: exitPrice }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Server error ${res.status}`);
    }
    await load(true); // silent refresh — no loading flash
  }

  async function handleClear(id: number, direction: 'long' | 'short') {
    const res = await fetch('/api/strategy-signals', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, direction, actualEntryPrice: null, actualExitPrice: null }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Server error ${res.status}`);
    }
    await load(true);
  }

  async function handleDelete(id: number) {
    await fetch(`/api/strategy-signals?id=${id}`, { method: 'DELETE' });
    setSignals((prev) => prev.filter((s) => s.id !== id));
  }

  const metrics = computeSignalMetrics(signals);

  // ── Empty / loading states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-xs animate-pulse">
        Loading signals…
      </div>
    );
  }

  if (fetchErr) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-32 text-xs">
        <span className="text-red-400">{fetchErr}</span>
        <button onClick={() => void load()} className="text-text-muted hover:text-text-primary underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Metrics bar ──────────────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 border-b border-surface-border px-3 py-3 bg-surface-raised/40
                       transition-opacity ${refreshing ? 'opacity-60' : 'opacity-100'}`}>
        {signals.length === 0 ? (
          <p className="text-xs text-text-muted italic">
            No signals yet. Signals are logged when the cron fires and Telegram delivers.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <MetricCard label="Total"    value={String(metrics.total)} />
              <MetricCard label="Open"     value={String(metrics.open)}  color="text-text-secondary" />
              <MetricCard label="Wins"     value={String(metrics.wins)}  color="text-emerald-400" />
              <MetricCard label="Losses"   value={String(metrics.losses)} color="text-red-400" />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <MetricCard
                label="Win Rate"
                value={metrics.wins + metrics.losses > 0 ? metrics.winRate.toFixed(1) + '%' : '—'}
                color={metrics.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}
              />
              <MetricCard
                label="Avg Win"
                value={metrics.wins > 0 ? fmtPct(metrics.avgWin) : '—'}
                color="text-emerald-400"
              />
              <MetricCard
                label="Avg Loss"
                value={metrics.losses > 0 ? fmtPct(metrics.avgLoss) : '—'}
                color="text-red-400"
              />
              <MetricCard
                label="Total P&L"
                value={metrics.wins + metrics.losses > 0 ? fmtPct(metrics.totalPnl) : '—'}
                color={metrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Signal list ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {signals.length === 0 ? null : signals.map((signal) => (
          <SignalRow
            key={signal.id}
            signal={signal}
            onSave={handleSave}
            onClear={handleClear}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
