'use client';

/**
 * SignalHistory — shows all cron-fired signals for the active strategy.
 *
 * Metrics bar: total, open, wins, losses, win rate, avg win/loss, total P&L.
 * Signal list: each row shows entry details + an inline P&L editor.
 * P&L input accepts: "+3.5", "-2.1", "3.5%", "-2.1%", "3.5" (positive assumed).
 */

import { useState, useEffect, useCallback } from 'react';
import type { StrategySignalRow } from '@/lib/strategy/signalMetrics';
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

/** Parse "+3.5", "-2.1", "3.5%", "-2.1%" → number or null */
function parsePnl(raw: string): number | null {
  const cleaned = raw.trim().replace(/%$/, '');
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
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

// ── Signal row ────────────────────────────────────────────────────────────────

interface SignalRowProps {
  signal:   StrategySignalRow;
  onSave:   (id: number, raw: string) => Promise<void>;
  onClear:  (id: number) => Promise<void>;
  onDelete: (id: number) => void;
}

function SignalRow({ signal, onSave, onClear, onDelete }: SignalRowProps) {
  const [editing,  setEditing]  = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const isLong  = signal.direction === 'long';
  const hasOutcome = signal.pnl_pct !== null;
  const isWin   = hasOutcome && signal.pnl_pct! > 0;
  const isLoss  = hasOutcome && signal.pnl_pct! < 0;

  async function handleSubmit() {
    const trimmed = inputVal.trim();
    if (!trimmed) { setEditing(false); return; }
    const parsed = parsePnl(trimmed);
    if (parsed === null) { setError('Enter e.g. +3.5 or -2.1'); return; }
    setSaving(true);
    setError('');
    await onSave(signal.id, trimmed);
    setSaving(false);
    setEditing(false);
    setInputVal('');
  }

  return (
    <div className={`border-b border-surface-border px-3 py-2.5 text-xs
                     hover:bg-surface-2 transition-colors group
                     ${isWin ? 'border-l-2 border-l-emerald-500/50' : ''}
                     ${isLoss ? 'border-l-2 border-l-red-500/50' : ''}
                     ${!hasOutcome ? 'border-l-2 border-l-transparent' : ''}`}>

      {/* ── Row top: direction + symbol + entry price ── */}
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
        <span className="font-mono font-semibold text-text-primary flex-shrink-0">
          {fmtPrice(signal.entry_price)}
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

      {/* ── Row bottom: outcome + edit ── */}
      <div className="flex items-center gap-2">
        {!editing ? (
          <>
            {hasOutcome ? (
              <>
                <span className={`font-mono font-semibold text-sm
                                  ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-text-muted'}`}>
                  {fmtPct(signal.pnl_pct!)}
                </span>
                {signal.outcome_note && (
                  <span className="text-text-muted truncate max-w-[100px]" title={signal.outcome_note}>
                    {signal.outcome_note}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { setInputVal(String(signal.pnl_pct)); setEditing(true); }}
                  className="text-[10px] text-text-muted hover:text-text-primary ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => onClear(signal.id)}
                  className="text-[10px] text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Clear outcome"
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <span className="text-[10px] font-mono text-text-muted italic">open</span>
                <button
                  type="button"
                  onClick={() => { setInputVal(''); setEditing(true); }}
                  className="text-[10px] px-2 py-0.5 rounded border border-surface-border
                             text-text-muted hover:text-text-primary hover:border-accent/50
                             ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  + record result
                </button>
              </>
            )}

            {/* Delete button */}
            <button
              type="button"
              onClick={() => { if (confirm('Delete this signal?')) onDelete(signal.id); }}
              className="text-[10px] text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
              title="Delete signal"
            >
              🗑
            </button>
          </>
        ) : (
          /* ── Inline P&L editor ── */
          <div className="flex items-center gap-1.5 flex-1">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => { setInputVal(e.target.value); setError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  void handleSubmit();
                if (e.key === 'Escape') { setEditing(false); setError(''); }
              }}
              placeholder="+3.5 or -2.1"
              autoFocus
              className="w-28 bg-surface border border-slate-600 rounded px-2 py-1
                         font-mono text-xs text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:border-blue-500"
            />
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
            {error && <span className="text-red-400 text-[10px]">{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SignalHistory({ strategyId }: Props) {
  const [signals,  setSignals]  = useState<StrategySignalRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [fetchErr, setFetchErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
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
    }
  }, [strategyId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(id: number, raw: string) {
    await fetch('/api/strategy-signals', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, pnlPct: raw }),
    });
    await load();
  }

  async function handleClear(id: number) {
    await fetch('/api/strategy-signals', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, pnlPct: null }),
    });
    await load();
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
      <div className="flex-shrink-0 border-b border-surface-border px-3 py-3 bg-surface-raised/40">
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
