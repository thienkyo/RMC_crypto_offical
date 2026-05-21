'use client';

/**
 * PortfolioOverview — cross-strategy performance summary.
 *
 * Content is constrained to max-w-4xl and left-aligned — terminal feel,
 * not full-bleed. The outer shell is a scrollable viewport; the inner
 * wrapper caps width so nothing stretches on wide monitors.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
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

// ─── Main component ────────────────────────────────────────────────────────────

export function PortfolioOverview() {
  const { data: signals = [], isLoading, error } = useAllSignals();

  const metrics   = useMemo(() => computeSignalMetrics(signals), [signals]);
  const taken     = useMemo(() => signals.filter((s) => s.actual_entry_price !== null).length, [signals]);
  const curve     = useMemo(() => buildEquityPoints(signals), [signals]);
  const histogram = useMemo(() => buildPnlBuckets(signals),   [signals]);
  const breakdown = useMemo(() => buildBreakdown(signals),     [signals]);
  const recent50  = useMemo(() => [...signals].slice(0, 50),   [signals]);

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
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-[9px] text-text-muted uppercase tracking-wider border-b border-surface-border">
                <th className="text-left pb-1 pr-3 font-normal">Strategy</th>
                <th className="text-left pb-1 pr-3 font-normal w-24">Symbol</th>
                <th className="text-left pb-1 pr-3 font-normal w-12">Dir</th>
                <th className="text-right pb-1 pr-3 font-normal w-28">Entry</th>
                <th className="text-right pb-1 pr-3 font-normal w-16">P&amp;L</th>
                <th className="text-right pb-1 font-normal w-28">Fired</th>
              </tr>
            </thead>
            <tbody>
              {recent50.map((s) => {
                const pnlCls =
                  s.pnl_pct === null ? 'text-text-muted' :
                  s.pnl_pct > 0      ? 'text-up'         : 'text-down';
                const pnlLabel =
                  s.pnl_pct === null
                    ? 'open'
                    : `${s.pnl_pct >= 0 ? '+' : ''}${s.pnl_pct.toFixed(2)}%`;
                return (
                  <tr key={s.id} className="border-b border-surface-border/40 hover:bg-surface-2">
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
                    <td className="py-1.5 text-right text-text-muted tabular-nums">
                      {format(new Date(s.fired_at), 'MM/dd HH:mm')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
