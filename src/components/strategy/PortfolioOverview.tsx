'use client';

/**
 * PortfolioOverview — cross-strategy performance summary.
 *
 * Content is constrained to max-w-4xl and left-aligned — terminal feel,
 * not full-bleed. The outer shell is a scrollable viewport; the inner
 * wrapper caps width so nothing stretches on wide monitors.
 */

import { useMemo, useState, useCallback, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { format } from 'date-fns';
import { computeSignalMetrics } from '@/lib/strategy/signalMetrics';
import type { StrategySignalRow } from '@/lib/strategy/signalMetrics';

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function fetchAllSignals(): Promise<StrategySignalRow[]> {
  const res = await fetch('/api/strategy-signals');
  if (!res.ok) throw new Error(`Failed to fetch signals: ${res.status}`);
  return res.json() as Promise<StrategySignalRow[]>;
}

function useAllSignals() {
  return useQuery({
    queryKey:        ['strategy-signals', 'portfolio'],
    queryFn:         fetchAllSignals,
    refetchInterval: 60_000,
    staleTime:       30_000,
  });
}

// ─── Pure computations ─────────────────────────────────────────────────────────

interface StrategyBreakdown {
  strategyId:   string;
  strategyName: string;
  total:   number;
  taken:   number;
  wins:    number;
  losses:  number;
  winRate: number;
  totalPnl: number;
}

function buildEquityPoints(signals: StrategySignalRow[]): { time: number; value: number }[] {
  const closed = signals
    .filter((s) => s.pnl_pct !== null && s.outcome_at !== null)
    .sort((a, b) => a.outcome_at! - b.outcome_at!);
  if (closed.length === 0) return [];
  let cum = 0;
  return closed.map((s) => {
    cum += s.pnl_pct!;
    return { time: s.outcome_at!, value: parseFloat(cum.toFixed(2)) };
  });
}

function buildPnlBuckets(signals: StrategySignalRow[]): { label: string; count: number; positive: boolean }[] {
  const pnls = signals.filter((s) => s.pnl_pct !== null).map((s) => s.pnl_pct!);
  if (pnls.length === 0) return [];
  const min = Math.floor(Math.min(...pnls) / 2) * 2;
  const max = Math.ceil(Math.max(...pnls)  / 2) * 2;
  const buckets = new Map<number, number>();
  for (let lo = min; lo < max; lo += 2) buckets.set(lo, 0);
  for (const pnl of pnls) {
    const lo = Math.floor(pnl / 2) * 2;
    buckets.set(lo, (buckets.get(lo) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([lo, count]) => ({
      label:    `${lo >= 0 ? '+' : ''}${lo}%`,
      count,
      positive: lo >= 0,
    }));
}

function buildBreakdown(signals: StrategySignalRow[]): StrategyBreakdown[] {
  const map = new Map<string, StrategySignalRow[]>();
  for (const s of signals) {
    const arr = map.get(s.strategy_id) ?? [];
    arr.push(s);
    map.set(s.strategy_id, arr);
  }
  return Array.from(map.values()).map((rows) => {
    const m     = computeSignalMetrics(rows);
    const taken = rows.filter((r) => r.actual_entry_price !== null).length;
    return {
      strategyId:   rows[0]!.strategy_id,
      strategyName: rows[0]!.strategy_name,
      total:    m.total,
      taken,
      wins:     m.wins,
      losses:   m.losses,
      winRate:  m.winRate,
      totalPnl: m.totalPnl,
    };
  }).sort((a, b) => b.totalPnl - a.totalPnl);
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

interface CurveTP { active?: boolean; payload?: { value: number }[]; label?: number }
function CurveTooltip({ active, payload, label }: CurveTP) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded border border-surface-border bg-surface px-2 py-1 text-[10px] font-mono">
      <div className="text-text-muted">{label ? format(new Date(label), 'dd MMM HH:mm') : ''}</div>
      <div className={v >= 0 ? 'text-up' : 'text-down'}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</div>
    </div>
  );
}

interface HistTP { active?: boolean; payload?: { value: number }[]; label?: string }
function HistTooltip({ active, payload, label }: HistTP) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-surface-border bg-surface px-2 py-1 text-[10px] font-mono">
      <div className="text-text-muted">{label}</div>
      <div className="text-text-primary">{payload[0]?.value} trades</div>
    </div>
  );
}

// ─── KPI card — fixed width, never grows ──────────────────────────────────────

interface KpiProps { label: string; value: string; sub?: string; color?: string }
function KpiCard({ label, value, sub, color }: KpiProps) {
  return (
    <div className="flex-shrink-0 flex flex-col gap-0.5 pr-6 mr-6 border-r border-surface-border last:border-r-0 last:mr-0 last:pr-0">
      <span className="text-[9px] font-mono uppercase tracking-widest text-text-muted whitespace-nowrap">
        {label}
      </span>
      <span className={`text-base font-mono font-bold tabular-nums leading-tight ${color ?? 'text-text-primary'}`}>
        {value}
      </span>
      {sub && <span className="text-[9px] text-text-muted font-mono whitespace-nowrap">{sub}</span>}
    </div>
  );
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-mono uppercase tracking-widest text-text-muted mb-2">
      {children}
    </div>
  );
}

// ─── Trade recording helpers ──────────────────────────────────────────────────

/** Strip leading $ and commas, return positive number or null. */
function parsePrice(raw: string): number | null {
  const v = parseFloat(raw.trim().replace(/^\$/, '').replace(/,/g, ''));
  return isNaN(v) || v <= 0 ? null : v;
}

function calcPnl(entry: number, exit: number, direction: 'long' | 'short'): number {
  return direction === 'long'
    ? (exit - entry) / entry * 100
    : (entry - exit) / entry * 100;
}

function fmtPx(n: number): string {
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1)    return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

// ─── Inline trade-record editor embedded in a table row ──────────────────────

interface TradeEditorRowProps {
  signal:    StrategySignalRow;
  colSpan:   number;
  onSave:    (id: number, entry: number | null, exit: number | null, direction: 'long' | 'short') => Promise<void>;
  onCancel:  () => void;
}

function TradeEditorRow({ signal, colSpan, onSave, onCancel }: TradeEditorRowProps) {
  const [entryInput, setEntryInput] = useState(
    signal.actual_entry_price != null ? String(signal.actual_entry_price) : '',
  );
  const [exitInput, setExitInput] = useState(
    signal.actual_exit_price != null ? String(signal.actual_exit_price) : '',
  );
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const previewEntry = parsePrice(entryInput);
  const previewExit  = parsePrice(exitInput);
  const previewPnl   = previewEntry && previewExit
    ? calcPnl(previewEntry, previewExit, signal.direction)
    : null;

  async function handleSave() {
    const entry = parsePrice(entryInput);
    if (!entry) { setErr('Enter a valid buy price'); return; }
    setSaving(true);
    setErr('');
    try {
      await onSave(signal.id, entry, parsePrice(exitInput), signal.direction);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <tr className="bg-surface-2 border-b border-surface-border">
      <td colSpan={colSpan} className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {/* Buy price */}
          <label className="flex items-center gap-1 text-text-muted">
            Buy
            <input
              type="text"
              placeholder="entry price"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
              className="w-24 rounded border border-surface-border bg-surface px-1.5 py-0.5
                         text-text-primary placeholder:text-text-muted/40 outline-none
                         focus:border-blue-500/60 tabular-nums"
            />
          </label>

          {/* Exit price */}
          <label className="flex items-center gap-1 text-text-muted">
            Exit
            <input
              type="text"
              placeholder="optional"
              value={exitInput}
              onChange={(e) => setExitInput(e.target.value)}
              className="w-24 rounded border border-surface-border bg-surface px-1.5 py-0.5
                         text-text-primary placeholder:text-text-muted/40 outline-none
                         focus:border-blue-500/60 tabular-nums"
            />
          </label>

          {/* Live P&L preview */}
          {previewPnl !== null && (
            <span className={`font-semibold ${previewPnl >= 0 ? 'text-up' : 'text-down'}`}>
              {previewPnl >= 0 ? '+' : ''}{previewPnl.toFixed(2)}%
            </span>
          )}
          {previewEntry && !previewExit && (
            <span className="text-blue-400 italic text-[10px]">in trade</span>
          )}

          {/* Actions */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded px-2 py-0.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30
                       disabled:opacity-40 transition-colors text-[10px]"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-text-muted hover:text-text-secondary
                       transition-colors text-[10px]"
          >
            Cancel
          </button>

          {/* Error */}
          {err && <span className="text-down text-[10px]">{err}</span>}
        </div>

        {/* Show existing recorded prices if any */}
        {signal.actual_entry_price != null && (
          <div className="mt-1 text-[10px] text-text-muted font-mono">
            Currently recorded: buy {fmtPx(signal.actual_entry_price)}
            {signal.actual_exit_price != null && (
              <> → exit {fmtPx(signal.actual_exit_price)}
                <span className={`ml-1 font-semibold ${(signal.pnl_pct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                  {signal.pnl_pct != null
                    ? ((signal.pnl_pct >= 0 ? '+' : '') + signal.pnl_pct.toFixed(2) + '%')
                    : ''}
                </span>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function PortfolioOverview() {
  const queryClient = useQueryClient();
  const { data: signals = [], isLoading, error } = useAllSignals();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filterStrategy, setFilterStrategy] = useState('');
  const [filterSymbol,   setFilterSymbol]   = useState('');
  const [filterDir,      setFilterDir]      = useState<'all' | 'long' | 'short'>('all');
  const [filterOutcome,  setFilterOutcome]  = useState<'all' | 'open' | 'win' | 'loss'>('all');

  // Row currently open for trade recording (signal id or null)
  const [editingId, setEditingId] = useState<number | null>(null);

  const metrics   = useMemo(() => computeSignalMetrics(signals), [signals]);
  const taken     = useMemo(() => signals.filter((s) => s.actual_entry_price !== null).length, [signals]);
  const curve     = useMemo(() => buildEquityPoints(signals), [signals]);
  const histogram = useMemo(() => buildPnlBuckets(signals),   [signals]);
  const breakdown = useMemo(() => buildBreakdown(signals),     [signals]);

  // Unfiltered top-50, then apply filters
  const base50 = useMemo(() => [...signals].slice(0, 50), [signals]);

  const filteredSignals = useMemo(() => {
    const stratLower = filterStrategy.trim().toLowerCase();
    const symLower   = filterSymbol.trim().toLowerCase();
    return base50.filter((s) => {
      if (stratLower && !s.strategy_name.toLowerCase().includes(stratLower)) return false;
      if (symLower   && !s.symbol.toLowerCase().includes(symLower))          return false;
      if (filterDir !== 'all' && s.direction !== filterDir)                  return false;
      if (filterOutcome === 'open' && s.pnl_pct !== null)                    return false;
      if (filterOutcome === 'win'  && (s.pnl_pct === null || s.pnl_pct <= 0)) return false;
      if (filterOutcome === 'loss' && (s.pnl_pct === null || s.pnl_pct >= 0)) return false;
      return true;
    });
  }, [base50, filterStrategy, filterSymbol, filterDir, filterOutcome]);

  const hasFilters = filterStrategy !== '' || filterSymbol !== ''
    || filterDir !== 'all' || filterOutcome !== 'all';

  // ── Trade recording ─────────────────────────────────────────────────────────
  const handleSaveTrade = useCallback(async (
    id:         number,
    entryPrice: number | null,
    exitPrice:  number | null,
    direction:  'long' | 'short',
  ) => {
    const res = await fetch('/api/strategy-signals', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, direction, actualEntryPrice: entryPrice, actualExitPrice: exitPrice }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error((body['error'] as string | undefined) ?? 'Save failed');
    }
    setEditingId(null);
    await queryClient.invalidateQueries({ queryKey: ['strategy-signals', 'portfolio'] });
  }, [queryClient]);

  const now = Date.now();
  const signalsThisWeek  = useMemo(
    () => signals.filter((s) => now - s.fired_at <= 7  * 24 * 60 * 60 * 1000).length,
    [signals],
  );
  const signalsThisMonth = useMemo(
    () => signals.filter((s) => now - s.fired_at <= 30 * 24 * 60 * 60 * 1000).length,
    [signals],
  );

  const lastVal    = curve[curve.length - 1]?.value ?? 0;
  const curveColor = lastVal >= 0 ? '#10b981' : '#ef4444';
  const winRateColor = metrics.winRate >= 50 ? 'text-up'
    : metrics.winRate > 0 ? 'text-yellow-400'
    : 'text-text-muted';
  const pnlColor = metrics.totalPnl >= 0 ? 'text-up' : 'text-down';

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-[11px] text-text-muted animate-pulse">
      Loading portfolio…
    </div>
  );
  if (error) return (
    <div className="flex items-center justify-center h-full text-[11px] text-down">
      Failed to load portfolio data.
    </div>
  );
  if (signals.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
      <span className="text-3xl">📭</span>
      <p className="text-sm">No signals recorded yet.</p>
      <p className="text-[11px] text-text-muted/60">Signals appear here once strategies fire and you log outcomes.</p>
    </div>
  );

  return (
    /* Outer: full-height scrollable shell */
    <div className="h-full overflow-y-auto bg-surface">
      {/* Inner: max-width content column, left-anchored with padding */}
      <div className="max-w-4xl px-6 py-4 flex flex-col gap-6">

        {/* ── KPI strip ───────────────────────────────────────────────── */}
        <div className="flex items-start gap-0">
          <KpiCard
            label="Total Signals"
            value={metrics.total.toString()}
            sub={`${taken} positions taken`}
          />
          <KpiCard
            label="Win Rate"
            value={metrics.winRate > 0 ? `${metrics.winRate.toFixed(1)}%` : '—'}
            sub={`${metrics.wins}W · ${metrics.losses}L`}
            color={winRateColor}
          />
          <KpiCard
            label="Total P&L"
            value={metrics.totalPnl !== 0
              ? `${metrics.totalPnl >= 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)}%`
              : '—'}
            sub={`${metrics.open} still open`}
            color={pnlColor}
          />
          <KpiCard
            label="Avg Win"
            value={metrics.avgWin > 0 ? `+${metrics.avgWin.toFixed(2)}%` : '—'}
            color="text-up"
          />
          <KpiCard
            label="Avg Loss"
            value={metrics.avgLoss < 0 ? `${metrics.avgLoss.toFixed(2)}%` : '—'}
            color="text-down"
          />
          <KpiCard
            label="This Week"
            value={signalsThisWeek.toString()}
            sub="signals (7d)"
          />
          <KpiCard
            label="This Month"
            value={signalsThisMonth.toString()}
            sub="signals (30d)"
          />
        </div>

        {/* ── Cumulative P&L curve ─────────────────────────────────────── */}
        <div>
          <SectionLabel>Cumulative P&amp;L (%)</SectionLabel>
          <div className="rounded border border-surface-border bg-surface-2 px-2 pt-2 pb-1">
            {curve.length >= 2 ? (
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={curve} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={curveColor} stopOpacity={0.3}  />
                      <stop offset="95%" stopColor={curveColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="time" type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(t: number) => format(new Date(t), 'MMM dd')}
                    tick={{ fill: '#6b7280', fontSize: 9 }}
                    axisLine={false} tickLine={false} minTickGap={60}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
                    tick={{ fill: '#6b7280', fontSize: 9 }}
                    axisLine={false} tickLine={false} width={38}
                  />
                  <Tooltip content={<CurveTooltip />} />
                  <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" strokeWidth={1} />
                  <Area
                    type="monotone" dataKey="value"
                    stroke={curveColor} strokeWidth={1.5}
                    fill="url(#portfolioGrad)"
                    dot={false} activeDot={{ r: 3, fill: curveColor }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[110px] flex items-center justify-center text-[11px] text-text-muted">
                Not enough closed trades to draw curve.
              </div>
            )}
          </div>
        </div>

        {/* ── Strategy breakdown + histogram side-by-side ──────────────── */}
        <div className="flex gap-6 items-start">

          {/* Strategy breakdown table */}
          <div className="flex-1 min-w-0">
            <SectionLabel>By Strategy</SectionLabel>
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="text-[9px] text-text-muted uppercase tracking-wider border-b border-surface-border">
                  <th className="text-left pb-1 pr-4 font-normal">Name</th>
                  <th className="text-right pb-1 pr-4 font-normal w-12">Sigs</th>
                  <th className="text-right pb-1 pr-4 font-normal w-14">WR%</th>
                  <th className="text-right pb-1 font-normal w-16">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.strategyId} className="border-b border-surface-border/40 hover:bg-surface-2">
                    <td className="py-1.5 pr-4 text-text-secondary truncate max-w-[200px]">
                      {row.strategyName}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-text-muted">
                      {row.total}
                    </td>
                    <td className={`py-1.5 pr-4 text-right tabular-nums ${row.winRate >= 50 ? 'text-up' : 'text-text-muted'}`}>
                      {row.winRate > 0 ? `${row.winRate.toFixed(0)}%` : '—'}
                    </td>
                    <td className={`py-1.5 text-right tabular-nums ${row.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                      {row.totalPnl !== 0
                        ? `${row.totalPnl >= 0 ? '+' : ''}${row.totalPnl.toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* P&L distribution histogram */}
          <div className="w-48 flex-shrink-0">
            <SectionLabel>P&amp;L Distribution</SectionLabel>
            <div className="rounded border border-surface-border bg-surface-2 px-1 pt-2 pb-1">
              {histogram.length >= 2 ? (
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={histogram} margin={{ top: 0, right: 4, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6b7280', fontSize: 9 }}
                      axisLine={false} tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#6b7280', fontSize: 9 }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip content={<HistTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {histogram.map((entry, i) => (
                        <Cell key={i} fill={entry.positive ? '#10b981' : '#ef4444'} fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[100px] flex items-center justify-center text-[10px] text-text-muted">
                  Need more closed trades.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Recent signal feed ───────────────────────────────────────── */}
        <div>
          <SectionLabel>Recent Signals (last 50)</SectionLabel>

          {/* ── Filter bar ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {/* Strategy name filter */}
            <input
              type="text"
              placeholder="Strategy…"
              value={filterStrategy}
              onChange={(e) => setFilterStrategy(e.target.value)}
              className="h-6 rounded border border-surface-border bg-surface px-2 text-[10px]
                         font-mono text-text-primary placeholder:text-text-muted/50 outline-none
                         focus:border-blue-500/60 w-32"
            />
            {/* Symbol filter */}
            <input
              type="text"
              placeholder="Symbol…"
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="h-6 rounded border border-surface-border bg-surface px-2 text-[10px]
                         font-mono text-text-primary placeholder:text-text-muted/50 outline-none
                         focus:border-blue-500/60 w-24"
            />
            {/* Direction dropdown */}
            <select
              value={filterDir}
              onChange={(e) => setFilterDir(e.target.value as 'all' | 'long' | 'short')}
              className="h-6 rounded border border-surface-border bg-surface px-1.5 text-[10px]
                         font-mono text-text-primary outline-none focus:border-blue-500/60 cursor-pointer"
            >
              <option value="all">All dirs</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            {/* Outcome dropdown */}
            <select
              value={filterOutcome}
              onChange={(e) => setFilterOutcome(e.target.value as 'all' | 'open' | 'win' | 'loss')}
              className="h-6 rounded border border-surface-border bg-surface px-1.5 text-[10px]
                         font-mono text-text-primary outline-none focus:border-blue-500/60 cursor-pointer"
            >
              <option value="all">All outcomes</option>
              <option value="open">Open</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
            {/* Clear filters */}
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilterStrategy('');
                  setFilterSymbol('');
                  setFilterDir('all');
                  setFilterOutcome('all');
                }}
                className="h-6 rounded px-2 text-[10px] font-mono text-text-muted
                           hover:text-text-secondary transition-colors"
              >
                ✕ clear
              </button>
            )}
            {/* Result count */}
            <span className="text-[10px] text-text-muted font-mono ml-auto">
              {filteredSignals.length} / {base50.length}
            </span>
          </div>

          {/* ── Table ──────────────────────────────────────────────────── */}
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[9px] text-text-muted uppercase tracking-wider border-b border-surface-border">
                <th className="text-left pb-1 pr-3 font-normal">Strategy</th>
                <th className="text-left pb-1 pr-3 font-normal w-24">Symbol</th>
                <th className="text-left pb-1 pr-3 font-normal w-12">Dir</th>
                <th className="text-right pb-1 pr-3 font-normal w-28">Sig Price</th>
                <th className="text-right pb-1 pr-3 font-normal w-20">P&amp;L</th>
                <th className="text-right pb-1 pr-3 font-normal w-28">Fired</th>
                <th className="text-right pb-1 font-normal w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filteredSignals.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[11px] text-text-muted">
                    No signals match the current filters.
                  </td>
                </tr>
              )}
              {filteredSignals.map((s) => {
                const pnlCls =
                  s.pnl_pct === null ? 'text-text-muted' :
                  s.pnl_pct > 0      ? 'text-up'         : 'text-down';
                const pnlLabel =
                  s.pnl_pct === null && s.actual_entry_price !== null
                    ? 'in trade'
                    : s.pnl_pct === null
                    ? 'open'
                    : `${s.pnl_pct >= 0 ? '+' : ''}${s.pnl_pct.toFixed(2)}%`;

                const hasRecord = s.actual_entry_price !== null;
                const isEditing = editingId === s.id;

                return (
                  <Fragment key={s.id}>
                    <tr
                      className={`border-b border-surface-border/40 hover:bg-surface-2
                        ${isEditing ? 'bg-surface-2' : ''}`}
                    >
                      <td className="py-1.5 pr-3 text-text-secondary truncate max-w-[160px]">
                        {s.strategy_name}
                      </td>
                      <td className="py-1.5 pr-3 text-text-primary">{s.symbol}</td>
                      <td className={`py-1.5 pr-3 uppercase font-bold text-[10px]
                        ${s.direction === 'long' ? 'text-up' : 'text-down'}`}>
                        {s.direction}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text-price tabular-nums">
                        {s.entry_price.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${pnlCls}`}>
                        {pnlLabel}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-text-muted tabular-nums">
                        {format(new Date(s.fired_at), 'MM/dd HH:mm')}
                      </td>
                      {/* Record / Edit trade button */}
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingId(isEditing ? null : s.id)}
                          className={`text-[10px] rounded px-1.5 py-0.5 transition-colors
                            ${isEditing
                              ? 'text-text-muted hover:text-text-secondary'
                              : hasRecord
                              ? 'text-blue-400/70 hover:text-blue-400'
                              : 'text-text-muted hover:text-text-secondary'
                            }`}
                        >
                          {isEditing ? 'cancel' : hasRecord ? 'edit trade' : '+ record'}
                        </button>
                      </td>
                    </tr>

                    {/* Inline editor row */}
                    {isEditing && (
                      <TradeEditorRow
                        signal={s}
                        colSpan={7}
                        onSave={handleSaveTrade}
                        onCancel={() => setEditingId(null)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
