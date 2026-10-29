'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useChartStore } from '@/store/chart';
import { ratingToGrade } from '@/lib/strategy/rating';
import type { StrategySignalRow } from '@/lib/strategy/signalMetrics';
import type { SignalMonitorRow } from '@/lib/alerts/signalMonitor';
import type { Timeframe } from '@/types/market';
import { formatUsdPrice } from '@/lib/format';
import { clsx } from 'clsx';

const fmtPrice = (n: number) => formatUsdPrice(n, 4);

function fmtTimeAgo(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

export function RecentSignalsStrip() {
  const queryClient = useQueryClient();
  const activeSymbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setTimeframe = useChartStore((s) => s.setTimeframe);
  const markerSettings = useChartStore((s) => s.markerSettings);
  const setMarkerSettings = useChartStore((s) => s.setMarkerSettings);

  const isVisible = markerSettings.recentSignalsVisible ?? true;

  // Poll for latest strategy signals every 15s
  const { data: signals = [], isLoading } = useQuery<StrategySignalRow[]>({
    queryKey: ['recent-signals-strip'],
    queryFn: async () => {
      const res = await fetch('/api/strategy-signals');
      if (!res.ok) throw new Error('Failed to fetch signals');
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Poll for active post-signal monitors every 15s
  const { data: activeMonitors = [] } = useQuery<SignalMonitorRow[]>({
    queryKey: ['active-signal-monitors'],
    queryFn: async () => {
      const res = await fetch('/api/signal-monitors');
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const monitorByKey = useMemo(() => {
    const map = new Map<string, SignalMonitorRow>();
    for (const m of activeMonitors) {
      if (m.signal_id) map.set(`id:${m.signal_id}`, m);
      map.set(`sym:${m.symbol}:${m.direction}`, m);
    }
    return map;
  }, [activeMonitors]);

  async function handleStopMonitor(e: React.MouseEvent, monitorId: number) {
    e.stopPropagation();
    try {
      await fetch(`/api/signal-monitors?id=${monitorId}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['active-signal-monitors'] });
    } catch {
      // ignore
    }
  }

  // Limit to most recent 20 signals
  const recentSignals = useMemo(() => {
    return (signals || []).slice(0, 20);
  }, [signals]);

  if (!isVisible) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-surface-1 border-b border-surface-border text-xs font-mono select-none overflow-hidden flex-shrink-0">
      {/* ── Label & live pulse ── */}
      <div className="flex items-center gap-1.5 flex-shrink-0 text-text-muted pr-1 border-r border-surface-border">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary whitespace-nowrap">
          Signals
        </span>
        {recentSignals.length > 0 && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-surface-3 text-text-muted">
            {recentSignals.length}
          </span>
        )}
        {activeMonitors.length > 0 && (
          <span
            className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold flex items-center gap-1"
            title={`${activeMonitors.length} active Post-Signal Monitor(s) tracking TP/SL/Breakeven & bar-close heartbeats`}
          >
            <span>👁</span>
            <span>{activeMonitors.length}</span>
          </span>
        )}
      </div>

      {/* ── Horizontal scrollable chips feed ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
        {isLoading && recentSignals.length === 0 ? (
          <span className="text-[11px] text-text-muted animate-pulse py-0.5">
            Loading signals feed…
          </span>
        ) : recentSignals.length === 0 ? (
          <span className="text-[11px] text-text-muted py-0.5">
            No signals fired yet. Active strategies are evaluating bars.
          </span>
        ) : (
          recentSignals.map((signal) => {
            const isLong = signal.direction === 'long';
            const isCurrent = signal.symbol === activeSymbol;
            const stars = signal.rating ? Math.min(7, Math.max(1, signal.rating)) : 4;
            const { grade, badgeClass } = ratingToGrade(signal.rating);
            const activeMonitor =
              signal.pnl_pct === null
                ? (monitorByKey.get(`id:${signal.id}`) ??
                   monitorByKey.get(`sym:${signal.symbol}:${signal.direction}`))
                : undefined;

            return (
              <div
                key={signal.id}
                onClick={() => {
                  setSymbol(signal.symbol);
                  if (signal.timeframe) {
                    setTimeframe(signal.timeframe as Timeframe);
                  }
                }}
                title={`Strategy: ${signal.strategy_name}\nTriggered: ${new Date(signal.fired_at).toLocaleString()}\nPrice: ${fmtPrice(signal.entry_price)}\nClick to view chart`}
                className={clsx(
                  'group flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer flex-shrink-0 transition-all text-[11px]',
                  isCurrent
                    ? 'bg-surface-3 border-accent/70 shadow-sm shadow-accent/10'
                    : 'bg-surface-2 border-surface-border hover:border-accent/40 hover:bg-surface-3',
                )}
              >
                {/* Direction pill */}
                <span
                  className={clsx(
                    'text-[9px] font-bold px-1 py-0.2 rounded flex-shrink-0',
                    isLong
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400',
                  )}
                >
                  {isLong ? '▲' : '▼'}
                </span>

                {/* Symbol & TF */}
                <span
                  className={clsx(
                    'font-semibold truncate',
                    isCurrent ? 'text-accent' : 'text-text-primary group-hover:text-accent',
                  )}
                >
                  {signal.symbol}
                </span>

                <span className="text-[10px] text-text-muted">
                  {signal.timeframe}
                </span>

                {/* Star rating */}
                <span className="text-yellow-400 text-[10px] flex-shrink-0 font-sans leading-none" title={`${stars} Star Conviction`}>
                  {'★'.repeat(stars)}
                </span>

                {/* Letter Grade */}
                <span
                  className={clsx(
                    'text-[9px] font-bold px-1 py-0.2 rounded border flex-shrink-0 uppercase',
                    badgeClass,
                  )}
                >
                  {grade}
                </span>

                {/* AI Verdict Badge */}
                {signal.ai_evaluation?.status && (
                  <span
                    className={clsx(
                      'text-[9px] font-mono font-bold px-1 py-0.2 rounded border flex-shrink-0 uppercase',
                      signal.ai_evaluation.status === 'PASS'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : signal.ai_evaluation.status === 'CAVEAT'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30',
                    )}
                    title={`AI Verdict: ${signal.ai_evaluation.status}\n${signal.ai_evaluation.summary}`}
                  >
                    {signal.ai_evaluation.status === 'PASS'
                      ? 'AI: PASS'
                      : signal.ai_evaluation.status === 'CAVEAT'
                      ? 'AI: CAVEAT'
                      : 'AI: REJECT'}
                  </span>
                )}


                {/* Signal price */}
                <span className="text-text-muted text-[10px] flex-shrink-0">
                  {fmtPrice(signal.entry_price)}
                </span>

                {/* P&L if resolved, or Active Monitor live status badge */}
                {signal.pnl_pct !== null ? (
                  <span
                    className={clsx(
                      'text-[10px] font-bold',
                      signal.pnl_pct >= 0 ? 'text-up' : 'text-down',
                    )}
                  >
                    {signal.pnl_pct >= 0 ? '+' : ''}{signal.pnl_pct.toFixed(1)}%
                  </span>
                ) : activeMonitor ? (
                  <span
                    className={clsx(
                      'text-[9px] font-mono font-semibold px-1 py-0.2 rounded border flex items-center gap-1',
                      activeMonitor.is_breakeven_armed
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
                    )}
                    title={
                      `Active Post-Signal Monitor #${activeMonitor.id}\n` +
                      `Status: ${activeMonitor.is_breakeven_armed ? 'Breakeven Armed (+1R)' : 'Watching TP/SL'}\n` +
                      `Confluence: ${activeMonitor.confluence_count}x\n` +
                      `MFE: +${parseFloat(activeMonitor.max_profit_pct || '0').toFixed(2)}% | MAE: ${parseFloat(activeMonitor.max_drawdown_pct || '0').toFixed(2)}%`
                    }
                  >
                    <span>{activeMonitor.is_breakeven_armed ? '🛡 BE' : '👁 LIVE'}</span>
                    {activeMonitor.confluence_count > 1 && (
                      <span className="text-[8px] opacity-90">×{activeMonitor.confluence_count}</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleStopMonitor(e, activeMonitor.id)}
                      className="hover:text-red-400 ml-0.5 leading-none"
                      title="Stop monitoring this signal"
                    >
                      ×
                    </button>
                  </span>
                ) : null}

                {/* Time ago */}
                <span className="text-[9px] text-text-muted/60 group-hover:text-text-muted flex-shrink-0">
                  {fmtTimeAgo(signal.fired_at)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* ── Close / Collapse button ── */}
      <button
        type="button"
        onClick={() => setMarkerSettings({ recentSignalsVisible: false })}
        title="Hide Recent Signals Strip (re-enable via Markers menu)"
        className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface-2 flex-shrink-0 text-[10px] leading-none ml-auto"
      >
        ✕
      </button>
    </div>
  );
}
