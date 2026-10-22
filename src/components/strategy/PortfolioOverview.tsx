'use client';

/**
 * PortfolioOverview — cross-strategy performance command center.
 *
 * Full-width responsive Bento layout:
 *  1. Top Command & Quality Gate Filter Bar
 *  2. 5 Hero KPI Cards (Net P&L + DD, Win Rate bar, Profit Factor & Expectancy, Directional Edge, AI Gatekeeper Alpha)
 *  3. 2-Column Analytics Workspace:
 *     - Left (7 cols): Equity / Drawdown Curve + P&L Distribution + Win Rate by Grade
 *     - Right (5 cols): Attribution Matrix (Grouped by Ticker with amber headers vs Flat Leaderboard)
 *  4. Bottom Signal & Trade Execution Ledger with 1-click Ticker Filter Pills and 3-panel Expandable Inspector Drawer.
 */

import { useMemo, useState, useCallback, useEffect, Fragment } from 'react';
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
import { computeSignalMetrics, type StrategySignalRow } from '@/lib/strategy/signalMetrics';
import { ratingToGrade } from '@/lib/strategy/rating';
import {
  DEFAULT_ALERT_POLL_INTERVAL_MS,
  getStoredAlertPollIntervalMs,
  setStoredAlertPollIntervalMs,
} from '@/hooks/useAlertPoller';
import {
  effectiveSignalRating,
  buildEquityPoints,
  buildPnlBuckets,
  buildBreakdown,
  buildTickerGroups,
  computeExtendedPortfolioMetrics,
} from '@/lib/strategy/portfolioAnalytics';

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

// ─── Tooltips ─────────────────────────────────────────────────────────────────

interface CurveTP {
  active?:  boolean;
  payload?: { value: number }[];
  label?:   number;
  mode:     'equity' | 'drawdown';
}

function CurveTooltip({ active, payload, label, mode }: CurveTP) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-mono shadow-lg">
      <div className="text-text-muted">{label ? format(new Date(label), 'dd MMM HH:mm') : ''}</div>
      <div className={v >= 0 ? 'text-up font-semibold' : 'text-down font-semibold'}>
        {mode === 'drawdown' ? 'DD: ' : ''}
        {v >= 0 ? '+' : ''}{v.toFixed(2)}%
      </div>
    </div>
  );
}

interface HistTP { active?: boolean; payload?: { value: number }[]; label?: string }
function HistTooltip({ active, payload, label }: HistTP) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-surface-border bg-surface px-2.5 py-1.5 text-xs font-mono shadow-lg">
      <div className="text-text-muted">{label}</div>
      <div className="text-text-primary font-semibold">{payload[0]?.value} trades</div>
    </div>
  );
}

// ─── Trade recording helpers ──────────────────────────────────────────────────

function parsePrice(raw: string): number | null {
  const v = parseFloat(raw.trim().replace(/^\$/, '').replace(/,/g, ''));
  return isNaN(v) || v <= 0 ? null : v;
}

function calcPnl(entry: number, exit: number, direction: 'long' | 'short'): number {
  return direction === 'long'
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
}

function fmtPx(n: number): string {
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)    return '$' + n.toFixed(2);
  return '$' + n.toFixed(6);
}

// ─── 3-Panel Signal Inspector & Trade Recorder Drawer ─────────────────────────

interface SignalInspectorDrawerProps {
  signal:   StrategySignalRow;
  colSpan:  number;
  onSave:   (id: number, entry: number | null, exit: number | null, direction: 'long' | 'short') => Promise<void>;
  onCancel: () => void;
}

function SignalInspectorDrawer({ signal, colSpan, onSave, onCancel }: SignalInspectorDrawerProps) {
  const [entryInput, setEntryInput] = useState(
    signal.actual_entry_price != null ? String(signal.actual_entry_price) : String(signal.entry_price),
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

  const passedConditions = useMemo(() => {
    if (!signal.conditions_snapshot) return [];
    return signal.conditions_snapshot.flatMap((group) =>
      group.conditions.filter((c) => c.passed),
    );
  }, [signal.conditions_snapshot]);

  const effRating = effectiveSignalRating(signal);
  const ai        = signal.ai_evaluation;

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
    <tr className="bg-surface border-b border-surface-border">
      <td colSpan={colSpan} className="p-3.5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono">

          {/* Panel 1: Fired Conditions Snapshot */}
          <div className="rounded-lg border border-surface-border bg-surface-2 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Confluence Snapshot
              </span>
              <span className="text-xs text-accent font-semibold">{effRating} / 7 ★</span>
            </div>
            <div className="text-xs text-text-muted pb-1 border-b border-surface-border/60 truncate" title={`sig#${signal.id} · ${signal.strategy_id}`}>
              Ref: <span className="text-text-secondary">sig#{signal.id}</span> · <span className="text-text-secondary">{signal.strategy_id}</span>
            </div>
            {passedConditions.length > 0 ? (
              <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                {passedConditions.map((c, idx) => (
                  <div key={idx} className="text-xs flex items-center justify-between gap-2">
                    <span className="text-emerald-400 truncate" title={c.label}>
                      ✓ {c.label}
                      {c.checkCandles && c.checkCandles > 1 ? ` [${c.checkMode === 'lookback' ? 'LB' : 'Conf'} ${c.checkCandles}]` : ''}
                    </span>
                    {c.value !== undefined && (
                      <span className="text-text-secondary tabular-nums flex-shrink-0">
                        {typeof c.value === 'number' ? c.value.toFixed(2) : c.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted italic">
                No condition snapshot recorded for this signal.
              </p>
            )}
          </div>

          {/* Panel 2: AI Gatekeeper Summary */}
          <div className="rounded-lg border border-surface-border bg-surface-2 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                AI Gatekeeper Verdict
              </span>
              {ai ? (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${
                  ai.status === 'PASS'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : ai.status === 'CAVEAT'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}>
                  {ai.status} · Tech {ai.metrics?.technicalScore ?? '—'}
                </span>
              ) : (
                <span className="text-xs text-text-muted">Not run</span>
              )}
            </div>
            {ai ? (
              <div className="space-y-1 text-xs">
                <p className="text-text-secondary leading-relaxed line-clamp-3" title={ai.summary}>
                  {ai.summary}
                </p>
                {ai.reasons?.primaryRisk && (
                  <p className="text-amber-400/90 truncate" title={ai.reasons.primaryRisk}>
                    Risk: {ai.reasons.primaryRisk}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-muted italic">
                AI Gatekeeper was not enabled or not triggered when this signal fired.
              </p>
            )}
          </div>

          {/* Panel 3: Manual / Binance Fill Override */}
          <div className="rounded-lg border border-surface-border bg-surface-2 p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Record / Edit Binance Fill
              </span>
              {previewPnl !== null && (
                <span className={`text-xs font-bold tabular-nums ${previewPnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {previewPnl >= 0 ? '+' : ''}{previewPnl.toFixed(2)}%
                </span>
              )}
              {previewEntry && !previewExit && (
                <span className="text-blue-400 italic text-xs">in trade</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1 text-text-muted">
                <span>Buy</span>
                <input
                  type="text"
                  placeholder="Entry $"
                  value={entryInput}
                  onChange={(e) => setEntryInput(e.target.value)}
                  className="w-24 rounded border border-surface-border bg-surface px-2 py-1
                             text-text-primary placeholder:text-text-muted/40 outline-none
                             focus:border-blue-500/60 tabular-nums"
                />
              </label>
              <span className="text-text-muted">→</span>
              <label className="flex items-center gap-1 text-text-muted">
                <span>Exit</span>
                <input
                  type="text"
                  placeholder="Optional $"
                  value={exitInput}
                  onChange={(e) => setExitInput(e.target.value)}
                  className="w-24 rounded border border-surface-border bg-surface px-2 py-1
                             text-text-primary placeholder:text-text-muted/40 outline-none
                             focus:border-blue-500/60 tabular-nums"
                />
              </label>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded px-2.5 py-1 bg-blue-500/20 border border-blue-500/40 text-blue-400
                           hover:bg-blue-500/30 disabled:opacity-40 transition-colors font-semibold"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded px-2 py-1 text-text-muted hover:text-text-secondary transition-colors"
              >
                Close
              </button>
            </div>

            {err ? (
              <div className="text-xs text-down">{err}</div>
            ) : signal.outcome_note ? (
              <div className="text-xs text-text-muted truncate" title={signal.outcome_note}>
                Note: <span className="text-text-secondary">{signal.outcome_note}</span>
              </div>
            ) : signal.actual_entry_price != null ? (
              <div className="text-xs text-text-muted">
                Recorded: buy {fmtPx(signal.actual_entry_price)}
                {signal.actual_exit_price != null ? ` → exit ${fmtPx(signal.actual_exit_price)}` : ''}
              </div>
            ) : (
              <div className="text-xs text-text-muted">
                Signal Price: {fmtPx(signal.entry_price)}
                {signal.entry_price_limit ? ` · Limit (-3%): ${fmtPx(signal.entry_price_limit)}` : ''}
              </div>
            )}
          </div>

        </div>
      </td>
    </tr>
  );
}

// ─── Date range presets ────────────────────────────────────────────────────────

type DateRangePreset = '7d' | '14d' | '30d' | '60d' | '90d' | 'all' | 'custom';

const DATE_RANGE_STORAGE_KEY = 'rmc_portfolio_date_range';

const PRESET_DAYS: Record<Exclude<DateRangePreset, 'all' | 'custom'>, number> = {
  '7d':  7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
};

const DATE_PRESET_OPTIONS: { id: DateRangePreset; label: string }[] = [
  { id: '7d',     label: '7D' },
  { id: '14d',    label: '14D' },
  { id: '30d',    label: '30D' },
  { id: '60d',    label: '60D' },
  { id: '90d',    label: '90D' },
  { id: 'all',    label: 'All' },
  { id: 'custom', label: 'Custom' },
];

const QUALITY_FILTER_STORAGE_KEY = 'rmc_portfolio_quality_filters';

const MIN_RATING_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Min Grade: All Grades' },
  { value: 3, label: 'Min Grade: ≥ C+ (3★)' },
  { value: 4, label: 'Min Grade: ≥ B (4★)' },
  { value: 5, label: 'Min Grade: ≥ B+ (5★)' },
  { value: 6, label: 'Min Grade: ≥ A (6★)' },
];

// ─── Main component ────────────────────────────────────────────────────────────

export function PortfolioOverview() {
  const queryClient = useQueryClient();
  const { data: signals = [], isLoading, error } = useAllSignals();

  // ── Portfolio Date Range state (persisted) ──────────────────────────────────
  const [datePreset, setDatePreset] = useState<DateRangePreset>('90d');
  const [customFrom, setCustomFrom] = useState<string>(() =>
    format(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
  );
  const [customTo, setCustomTo] = useState<string>('');

  // ── Global Quality & Strategy Pruning state (persisted) ─────────────────────
  const [minRating, setMinRating] = useState<number>(0);
  const [hideAiRejected, setHideAiRejected] = useState<boolean>(false);
  const [onlyProfitableStrategies, setOnlyProfitableStrategies] = useState<boolean>(false);
  const [mutedStrategyIds, setMutedStrategyIds] = useState<string[]>([]);

  // ── Chart & Attribution View toggles ────────────────────────────────────────
  const [chartView, setChartView]           = useState<'equity' | 'drawdown'>('equity');
  const [breakdownMode, setBreakdownMode]   = useState<'ticker' | 'flat'>('ticker');
  const [collapsedTickers, setCollapsedTickers] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DATE_RANGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          preset?: DateRangePreset;
          from?: string;
          to?: string;
        };
        if (parsed.preset && DATE_PRESET_OPTIONS.some((o) => o.id === parsed.preset)) {
          setDatePreset(parsed.preset);
        }
        if (typeof parsed.from === 'string' && parsed.from) {
          setCustomFrom(parsed.from);
        }
        if (typeof parsed.to === 'string') {
          setCustomTo(parsed.to);
        }
      }

      const rawQuality = localStorage.getItem(QUALITY_FILTER_STORAGE_KEY);
      if (rawQuality) {
        const parsedQ = JSON.parse(rawQuality) as {
          minRating?: number;
          hideAiRejected?: boolean;
          onlyProfitableStrategies?: boolean;
          mutedStrategyIds?: string[];
        };
        if (typeof parsedQ.minRating === 'number') setMinRating(parsedQ.minRating);
        if (typeof parsedQ.hideAiRejected === 'boolean') setHideAiRejected(parsedQ.hideAiRejected);
        if (typeof parsedQ.onlyProfitableStrategies === 'boolean') {
          setOnlyProfitableStrategies(parsedQ.onlyProfitableStrategies);
        }
        if (Array.isArray(parsedQ.mutedStrategyIds)) {
          setMutedStrategyIds(parsedQ.mutedStrategyIds);
        }
      }
    } catch {
      // ignore invalid storage
    }
  }, []);

  const persistQualityFilters = useCallback(
    (next: {
      minRating: number;
      hideAiRejected: boolean;
      onlyProfitableStrategies: boolean;
      mutedStrategyIds: string[];
    }) => {
      try {
        localStorage.setItem(QUALITY_FILTER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
    },
    [],
  );

  const persistDateRange = useCallback((preset: DateRangePreset, from: string, to: string) => {
    try {
      localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({ preset, from, to }));
    } catch {
      // ignore storage quota errors
    }
  }, []);

  const { sinceMs, untilMs } = useMemo(() => {
    if (datePreset === 'all') {
      return { sinceMs: undefined, untilMs: undefined };
    }
    if (datePreset === 'custom') {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : undefined;
      const end   = customTo   ? new Date(`${customTo}T23:59:59.999`).getTime() : undefined;
      return {
        sinceMs: start && !isNaN(start) ? start : undefined,
        untilMs: end   && !isNaN(end)   ? end   : undefined,
      };
    }
    const days = PRESET_DAYS[datePreset];
    return {
      sinceMs: Date.now() - days * 24 * 60 * 60 * 1000,
      untilMs: undefined,
    };
  }, [datePreset, customFrom, customTo]);

  // Signals within the active date window (before AI rejection filter, used for AI alpha attribution)
  const dateWindowSignals = useMemo(() => {
    return signals.filter((s) => {
      if (sinceMs !== undefined && s.fired_at < sinceMs) return false;
      if (untilMs !== undefined && s.fired_at > untilMs) return false;
      return true;
    });
  }, [signals, sinceMs, untilMs]);

  // 1. Date-filtered signals + Grade/AI quality filter
  const qualitySignals = useMemo(() => {
    return dateWindowSignals.filter((s) => {
      if (minRating > 0 && effectiveSignalRating(s) < minRating) return false;
      if (hideAiRejected && s.ai_evaluation?.status === 'REJECT') return false;
      return true;
    });
  }, [dateWindowSignals, minRating, hideAiRejected]);

  // 2. Full breakdown across qualitySignals so user can see and toggle every strategy
  const breakdown    = useMemo(() => buildBreakdown(qualitySignals), [qualitySignals]);
  const tickerGroups = useMemo(() => buildTickerGroups(breakdown), [breakdown]);

  // Set of excluded strategy IDs (either manually muted or auto-pruned as net-losing)
  const excludedStrategySet = useMemo(() => {
    const set = new Set<string>(mutedStrategyIds);
    if (onlyProfitableStrategies) {
      for (const row of breakdown) {
        if (row.totalPnl <= 0) {
          set.add(row.strategyId);
        }
      }
    }
    return set;
  }, [mutedStrategyIds, onlyProfitableStrategies, breakdown]);

  // 3. Final portfolio signals after strategy pruning
  const rangedSignals = useMemo(() => {
    if (excludedStrategySet.size === 0) return qualitySignals;
    return qualitySignals.filter((s) => !excludedStrategySet.has(s.strategy_id));
  }, [qualitySignals, excludedStrategySet]);

  const toggleMuteStrategy = useCallback(
    (strategyId: string) => {
      setMutedStrategyIds((prev) => {
        const next = prev.includes(strategyId)
          ? prev.filter((id) => id !== strategyId)
          : [...prev, strategyId];
        persistQualityFilters({
          minRating,
          hideAiRejected,
          onlyProfitableStrategies,
          mutedStrategyIds: next,
        });
        return next;
      });
    },
    [minRating, hideAiRejected, onlyProfitableStrategies, persistQualityFilters],
  );

  const toggleMuteTickerGroup = useCallback(
    (strategyIds: string[]) => {
      setMutedStrategyIds((prev) => {
        const allCurrentlyMuted = strategyIds.every((id) => prev.includes(id));
        const next = allCurrentlyMuted
          ? prev.filter((id) => !strategyIds.includes(id))
          : Array.from(new Set([...prev, ...strategyIds]));
        persistQualityFilters({
          minRating,
          hideAiRejected,
          onlyProfitableStrategies,
          mutedStrategyIds: next,
        });
        return next;
      });
    },
    [minRating, hideAiRejected, onlyProfitableStrategies, persistQualityFilters],
  );

  function toggleTickerCollapse(symbol: string) {
    setCollapsedTickers((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  // ── Ledger Filter state ─────────────────────────────────────────────────────
  const [filterStrategy, setFilterStrategy] = useState('');
  const [filterSymbol,   setFilterSymbol]   = useState<string>('ALL');
  const [filterDir,      setFilterDir]      = useState<'all' | 'long' | 'short'>('all');
  const [filterOutcome,  setFilterOutcome]  = useState<'all' | 'open' | 'win' | 'loss'>('all');

  // Row currently open for inspection / trade recording (signal id or null)
  const [editingId, setEditingId] = useState<number | null>(null);

  const metrics   = useMemo(() => computeSignalMetrics(rangedSignals), [rangedSignals]);
  const ext       = useMemo(
    () => computeExtendedPortfolioMetrics(rangedSignals, dateWindowSignals),
    [rangedSignals, dateWindowSignals],
  );
  const curve     = useMemo(() => buildEquityPoints(rangedSignals), [rangedSignals]);
  const histogram = useMemo(() => buildPnlBuckets(rangedSignals), [rangedSignals]);

  // 30-day P&L badge for KPI card 1
  const pnl30d = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return rangedSignals
      .filter((s) => s.fired_at >= cutoff && s.pnl_pct !== null)
      .reduce((acc, s) => acc + s.pnl_pct!, 0);
  }, [rangedSignals]);

  // Unfiltered top-100 within the active date range, then apply table filters
  const baseLedger = useMemo(() => [...rangedSignals].slice(0, 100), [rangedSignals]);

  // Ticker counts across baseLedger for 1-click Ticker Filter Pills
  const ledgerTickerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of baseLedger) {
      map.set(s.symbol, (map.get(s.symbol) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [baseLedger]);

  const filteredSignals = useMemo(() => {
    const q = filterStrategy.trim().toLowerCase();
    return baseLedger.filter((s) => {
      if (filterSymbol !== 'ALL' && s.symbol !== filterSymbol) return false;
      if (q) {
        const matchesName    = s.strategy_name.toLowerCase().includes(q);
        const matchesStratId = s.strategy_id.toLowerCase().includes(q);
        const matchesSigId   = `sig#${s.id}` === q || `#${s.id}` === q || String(s.id) === q;
        if (!matchesName && !matchesStratId && !matchesSigId) return false;
      }
      if (filterDir !== 'all' && s.direction !== filterDir)                  return false;
      if (filterOutcome === 'open' && s.pnl_pct !== null)                    return false;
      if (filterOutcome === 'win'  && (s.pnl_pct === null || s.pnl_pct <= 0)) return false;
      if (filterOutcome === 'loss' && (s.pnl_pct === null || s.pnl_pct >= 0)) return false;
      return true;
    });
  }, [baseLedger, filterStrategy, filterSymbol, filterDir, filterOutcome]);

  const hasFilters = filterStrategy !== '' || filterSymbol !== 'ALL'
    || filterDir !== 'all' || filterOutcome !== 'all';

  // ── Trade recording & Auto-Resolver settings ───────────────────────────────
  const [isResolving, setIsResolving]     = useState(false);
  const [resolveNotice, setResolveNotice] = useState<string | null>(null);
  const [entryMode, setEntryMode]         = useState<'limit' | 'market'>('limit');
  const [breakevenAt1R, setBreakevenAt1R] = useState<boolean>(true);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(DEFAULT_ALERT_POLL_INTERVAL_MS);

  useEffect(() => {
    setPollIntervalMs(getStoredAlertPollIntervalMs());
  }, []);

  const handleResolveSignals = useCallback(async () => {
    setIsResolving(true);
    setResolveNotice(null);
    try {
      const res = await fetch('/api/strategy-signals/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceAll: true,
          sinceMs,
          untilMs,
          entryMode,
          breakevenAt1R,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resolve signals');
      await queryClient.invalidateQueries({ queryKey: ['strategy-signals', 'portfolio'] });
      const unfilledTxt = data.summary.unfilled > 0 ? `, ${data.summary.unfilled} unfilled limit` : '';
      setResolveNotice(
        `Auto-checked ${data.summary.totalSignals} signals (${entryMode.toUpperCase()}${breakevenAt1R ? ' + 1R→BE' : ''}): ${data.summary.resolved} resolved (${data.summary.wins}W · ${data.summary.losses}L)${unfilledTxt}, ${data.summary.stillOpen} still open. Total P&L: ${data.summary.totalPnl >= 0 ? '+' : ''}${data.summary.totalPnl}%.`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Resolution failed');
    } finally {
      setIsResolving(false);
    }
  }, [queryClient, sinceMs, untilMs, entryMode, breakevenAt1R]);

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

  const lastVal    = curve[curve.length - 1]?.value ?? 0;
  const curveColor = chartView === 'drawdown'
    ? '#ef4444'
    : lastVal >= 0 ? '#10b981' : '#ef4444';

  const closedTradesCount = metrics.wins + metrics.losses;

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-xs text-text-muted font-mono animate-pulse">
      Loading portfolio command center…
    </div>
  );
  if (error) return (
    <div className="flex items-center justify-center h-full text-xs text-down font-mono">
      Failed to load portfolio data.
    </div>
  );
  if (signals.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted font-mono">
      <span className="text-3xl">📭</span>
      <p className="text-sm">No signals recorded yet.</p>
      <p className="text-xs text-text-muted/60">Signals appear here once strategies fire and you log outcomes.</p>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-surface font-mono select-none">
      <div className="w-full max-w-[1600px] mx-auto p-4 md:p-6 space-y-5">

        {/* ── 1. TOP COMMAND & QUALITY GATE BAR ────────────────────────────── */}
        <div className="rounded-xl border border-surface-border bg-surface-1 p-4 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Title & Live Status */}
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm font-bold tracking-wider uppercase text-text-primary">
                  Portfolio Command Center
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {rangedSignals.length} / {signals.length} Signals Active
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                Cross-strategy forward-test performance, AI gatekeeper attribution &amp; trade execution ledger
              </p>
            </div>

            {/* Primary Actions: Date Range + Simulation Mode + Auto-Check */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Date Range Segmented Control */}
              <div className="flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs">
                {DATE_PRESET_OPTIONS.map((opt) => {
                  const active = datePreset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setDatePreset(opt.id);
                        persistDateRange(opt.id, customFrom, customTo);
                      }}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        active
                          ? 'bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/40'
                          : 'text-text-muted hover:text-text-secondary border border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Execution Mode Toggles (Limit vs Market) */}
              <div
                className="flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs"
                title="Simulates either Pullback Limit Entry (entry_price_limit) or immediate Market Entry"
              >
                <button
                  type="button"
                  onClick={() => setEntryMode('limit')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    entryMode === 'limit'
                      ? 'bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/40'
                      : 'text-text-muted hover:text-text-secondary border border-transparent'
                  }`}
                >
                  Limit (-3%)
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('market')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    entryMode === 'market'
                      ? 'bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/40'
                      : 'text-text-muted hover:text-text-secondary border border-transparent'
                  }`}
                >
                  Market
                </button>
              </div>

              <button
                type="button"
                onClick={() => setBreakevenAt1R((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                  breakevenAt1R
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-semibold'
                    : 'border-surface-border bg-surface text-text-muted hover:text-text-secondary'
                }`}
                title="Move Stop-Loss to +0.15R profit lock once trade reaches +1R in favor"
              >
                1R → BE+ {breakevenAt1R ? 'ON' : 'OFF'}
              </button>

              {/* Live Signal Check Interval (5m / 10m / 15m) */}
              <div
                className="flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs"
                title="Live signal evaluation interval (evaluates forming candle every 5m, 10m, or 15m)"
              >
                <span className="px-2 text-text-muted">Poll:</span>
                {[
                  { ms: 5 * 60_000,  label: '5m' },
                  { ms: 10 * 60_000, label: '10m' },
                  { ms: 15 * 60_000, label: '15m' },
                ].map((opt) => {
                  const active = pollIntervalMs === opt.ms;
                  return (
                    <button
                      key={opt.ms}
                      type="button"
                      onClick={() => {
                        setPollIntervalMs(opt.ms);
                        setStoredAlertPollIntervalMs(opt.ms);
                      }}
                      className={`px-2 py-1 rounded-md transition-colors ${
                        active
                          ? 'bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/40'
                          : 'text-text-muted hover:text-text-secondary border border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={isResolving}
                onClick={handleResolveSignals}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-500/50 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-semibold transition-colors disabled:opacity-50"
                title="Automatically check triggers in the selected date range against market candles for Take-Profit and Stop-Loss outcomes"
              >
                {isResolving ? (
                  <>
                    <span className="animate-spin inline-block">⏳</span>
                    <span>Checking Candles…</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Auto-Check Triggers</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Second Row: Quality Gates & Custom Date Inputs */}
          <div className="pt-2.5 border-t border-surface-border flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-text-muted uppercase tracking-wider">Quality Gates:</span>

              <select
                value={minRating}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setMinRating(val);
                  persistQualityFilters({
                    minRating: val,
                    hideAiRejected,
                    onlyProfitableStrategies,
                    mutedStrategyIds,
                  });
                }}
                className="rounded-lg border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none focus:border-blue-500/60 cursor-pointer"
                title="Filter entire portfolio by minimum signal confluence grade / star rating"
              >
                {MIN_RATING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  const next = !hideAiRejected;
                  setHideAiRejected(next);
                  persistQualityFilters({
                    minRating,
                    hideAiRejected: next,
                    onlyProfitableStrategies,
                    mutedStrategyIds,
                  });
                }}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  hideAiRejected
                    ? 'border-blue-500/40 bg-blue-500/15 text-blue-400 font-semibold'
                    : 'border-surface-border bg-surface text-text-muted hover:text-text-secondary'
                }`}
                title="Exclude signals where AI Gatekeeper verdict was REJECT"
              >
                {hideAiRejected ? '✓ ' : ''}Hide AI Rejected ({ext.aiStats.rejectedCount})
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !onlyProfitableStrategies;
                  setOnlyProfitableStrategies(next);
                  persistQualityFilters({
                    minRating,
                    hideAiRejected,
                    onlyProfitableStrategies: next,
                    mutedStrategyIds,
                  });
                }}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  onlyProfitableStrategies
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-semibold'
                    : 'border-surface-border bg-surface text-text-muted hover:text-text-secondary'
                }`}
                title="Automatically prune losing strategies (net P&L <= 0%) from portfolio totals and equity curve"
              >
                {onlyProfitableStrategies ? '✓ ' : ''}Winning Strats Only
              </button>

              {mutedStrategyIds.length > 0 && (
                <span className="text-amber-400 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  {mutedStrategyIds.length} muted ·{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMutedStrategyIds([]);
                      persistQualityFilters({
                        minRating,
                        hideAiRejected,
                        onlyProfitableStrategies,
                        mutedStrategyIds: [],
                      });
                    }}
                    className="underline hover:no-underline"
                  >
                    Reset
                  </button>
                </span>
              )}
            </div>

            {/* Active Window or Custom Date Pickers */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              {datePreset === 'custom' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5">
                    <span>From</span>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomFrom(val);
                        persistDateRange('custom', val, customTo);
                      }}
                      className="rounded border border-surface-border bg-surface px-2 py-0.5 text-xs text-text-primary outline-none focus:border-blue-500/60"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span>To</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomTo(val);
                        persistDateRange('custom', customFrom, val);
                      }}
                      className="rounded border border-surface-border bg-surface px-2 py-0.5 text-xs text-text-primary outline-none focus:border-blue-500/60"
                    />
                  </label>
                  {customTo && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomTo('');
                        persistDateRange('custom', customFrom, '');
                      }}
                      className="text-text-muted hover:text-text-secondary px-1"
                    >
                      ✕ clear
                    </button>
                  )}
                </div>
              ) : (
                <span>
                  Window:{' '}
                  <span className="text-text-secondary">
                    {datePreset === 'all'
                      ? 'All time'
                      : `Since ${format(new Date(sinceMs!), 'MMM dd, yyyy')}`}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Auto-resolve feedback banner */}
        {resolveNotice && (
          <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 rounded-xl flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>✓</span>
              <span>{resolveNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setResolveNotice(null)}
              className="text-text-muted hover:text-text-primary ml-2 text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── 2. HERO KPI BENTO STRIP (5 CARDS) ────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* KPI 1: Net Cumulative P&L */}
          <div className="rounded-xl border border-surface-border bg-surface-1 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs uppercase tracking-wider text-text-muted">Net Cumulative P&amp;L</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold tabular-nums ${
                pnl30d >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                {pnl30d >= 0 ? '+' : ''}{pnl30d.toFixed(1)}% 30d
              </span>
            </div>
            <div className="my-2">
              <div className={`text-2xl font-bold tabular-nums ${
                metrics.totalPnl >= 0 ? 'text-up' : 'text-down'
              }`}>
                {closedTradesCount > 0
                  ? `${metrics.totalPnl >= 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)}%`
                  : '—'}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted pt-2 border-t border-surface-border">
              <span>
                Peak: <strong className="text-text-primary">+{ext.peakPnl.toFixed(1)}%</strong>
              </span>
              <span>
                Max DD: <strong className="text-down">{ext.maxDrawdown.toFixed(1)}%</strong>
              </span>
            </div>
          </div>

          {/* KPI 2: Win Rate + W/L Split Bar */}
          <div className="rounded-xl border border-surface-border bg-surface-1 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-text-muted">Win Rate</span>
              <span className="text-xs text-text-muted">{closedTradesCount} closed</span>
            </div>
            <div className="my-2">
              <div className={`text-2xl font-bold tabular-nums ${
                metrics.winRate >= 50 ? 'text-up' : metrics.winRate > 0 ? 'text-amber-400' : 'text-text-muted'
              }`}>
                {closedTradesCount > 0 ? `${metrics.winRate.toFixed(1)}%` : '—'}
              </div>
              <div className="w-full h-1.5 rounded-full bg-red-500/35 overflow-hidden mt-2 flex">
                <div
                  className="bg-emerald-400 h-full transition-all duration-300"
                  style={{ width: `${closedTradesCount > 0 ? metrics.winRate : 0}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-up font-semibold">{metrics.wins} Wins</span>
              <span className="text-down font-semibold">{metrics.losses} Losses</span>
              <span className="text-blue-400">{metrics.open} Open</span>
            </div>
          </div>

          {/* KPI 3: Profit Factor & Expectancy */}
          <div className="rounded-xl border border-surface-border bg-surface-1 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs uppercase tracking-wider text-text-muted">Profit Factor</span>
              <span className={`text-xs px-1.5 py-0.5 rounded tabular-nums ${
                ext.expectancy >= 0 ? 'bg-blue-500/15 text-blue-400' : 'bg-red-500/15 text-red-400'
              }`}>
                Exp {ext.expectancy >= 0 ? '+' : ''}{ext.expectancy.toFixed(2)}%
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-text-primary tabular-nums">
                {ext.profitFactor !== null ? ext.profitFactor.toFixed(2) : '—'}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted pt-2 border-t border-surface-border">
              <span>
                Avg W: <strong className="text-up">{metrics.avgWin > 0 ? `+${metrics.avgWin.toFixed(2)}%` : '—'}</strong>
              </span>
              <span>
                Avg L: <strong className="text-down">{metrics.avgLoss < 0 ? `${metrics.avgLoss.toFixed(2)}%` : '—'}</strong>
              </span>
            </div>
          </div>

          {/* KPI 4: Long vs Short Directional Edge */}
          <div className="rounded-xl border border-surface-border bg-surface-1 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-text-muted">Directional Edge</span>
              <span className="text-xs text-text-muted">L / S Split</span>
            </div>
            <div className="my-1.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-up font-semibold">▲ LONG ({ext.longStats.total})</span>
                <span className={`tabular-nums font-bold ${ext.longStats.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {ext.longStats.closed > 0 ? `${ext.longStats.winRate.toFixed(0)}% WR · ` : ''}
                  {ext.longStats.totalPnl >= 0 ? '+' : ''}{ext.longStats.totalPnl.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-down font-semibold">▼ SHORT ({ext.shortStats.total})</span>
                <span className={`tabular-nums font-bold ${ext.shortStats.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {ext.shortStats.closed > 0 ? `${ext.shortStats.winRate.toFixed(0)}% WR · ` : ''}
                  {ext.shortStats.totalPnl >= 0 ? '+' : ''}{ext.shortStats.totalPnl.toFixed(1)}%
                </span>
              </div>
            </div>
            <div className="text-xs text-text-muted pt-2 border-t border-surface-border flex justify-between">
              <span>{ext.takenManuallyCount} Taken Manually</span>
              <span className="text-amber-400">{ext.unfilledCount} Unfilled</span>
            </div>
          </div>

          {/* KPI 5: AI Gatekeeper Attribution */}
          <div className="rounded-xl border border-surface-border bg-surface-1 p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-text-muted">AI Gatekeeper</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-semibold">
                AI Alpha
              </span>
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold text-indigo-400 tabular-nums">
                +{ext.aiStats.savedLossPct.toFixed(1)}%{' '}
                <span className="text-xs font-normal text-text-muted">saved</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted pt-2 border-t border-surface-border">
              <span>
                PASS WR:{' '}
                <strong className="text-up">
                  {ext.aiStats.passCount > 0 ? `${ext.aiStats.passWinRate.toFixed(0)}%` : '—'}
                </strong>
              </span>
              <span>
                Rejected:{' '}
                <strong className="text-amber-400">
                  {ext.aiStats.rejectedLossesCount}/{ext.aiStats.rejectedClosedCount} lost
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* ── 3. MIDDLE ANALYTICS WORKSPACE (2 COLUMNS) ────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left Column (7 cols): Equity / Drawdown Curve + Mini Distribution Panels */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="rounded-xl border border-surface-border bg-surface-1 p-4 flex flex-col justify-between flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                    Equity Curve &amp; Drawdown
                  </h2>
                  <p className="text-xs text-text-muted">
                    {chartView === 'equity'
                      ? `Realized cumulative return across ${closedTradesCount} closed trades`
                      : `Underwater peak-to-trough drawdown (Max DD: ${ext.maxDrawdown.toFixed(2)}%)`}
                  </p>
                </div>

                <div className="flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setChartView('equity')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      chartView === 'equity'
                        ? 'bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/40'
                        : 'text-text-muted hover:text-text-secondary border border-transparent'
                    }`}
                  >
                    Equity (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartView('drawdown')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      chartView === 'drawdown'
                        ? 'bg-red-500/20 text-red-400 font-semibold border border-red-500/40'
                        : 'text-text-muted hover:text-text-secondary border border-transparent'
                    }`}
                  >
                    Drawdown
                  </button>
                </div>
              </div>

              {/* Main AreaChart */}
              <div className="rounded-lg border border-surface-border bg-surface px-2 pt-3 pb-1">
                {curve.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={curve} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={curveColor} stopOpacity={0.32} />
                          <stop offset="95%" stopColor={curveColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(t: number) => format(new Date(t), 'MMM dd')}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={60}
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                      />
                      <Tooltip content={<CurveTooltip mode={chartView} />} />
                      <ReferenceLine y={0} stroke="#1e2a3d" strokeDasharray="3 3" strokeWidth={1} />
                      <Area
                        type="monotone"
                        dataKey={chartView === 'equity' ? 'value' : 'drawdown'}
                        stroke={curveColor}
                        strokeWidth={2}
                        fill="url(#portfolioGrad)"
                        dot={false}
                        activeDot={{ r: 4, fill: curveColor }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[200px] flex items-center justify-center text-xs text-text-muted">
                    Not enough closed trades to draw curve.
                  </div>
                )}
              </div>

              {/* Bottom Mini-Panels: P&L Return Buckets + Win Rate by Grade */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                {/* P&L Distribution Histogram */}
                <div className="rounded-lg border border-surface-border bg-surface p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider text-text-muted">
                      P&amp;L Return Buckets
                    </span>
                    <span className="text-xs text-text-secondary">
                      {histogram.length} buckets
                    </span>
                  </div>
                  {histogram.length >= 2 ? (
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={histogram} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <XAxis
                          dataKey="label"
                          tick={{ fill: '#94a3b8', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fill: '#94a3b8', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<HistTooltip />} />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                          {histogram.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.positive ? '#10b981' : '#ef4444'}
                              fillOpacity={0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[100px] flex items-center justify-center text-xs text-text-muted">
                      Need more closed trades.
                    </div>
                  )}
                </div>

                {/* Win Rate by Confluence Grade */}
                <div className="rounded-lg border border-surface-border bg-surface p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wider text-text-muted">
                      Win Rate by Grade
                    </span>
                    <span className="text-xs text-blue-400">Confluence Edge</span>
                  </div>
                  <div className="space-y-2.5 my-auto">
                    {ext.gradeTiers.map((tier) => (
                      <div key={tier.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-14 font-bold flex-shrink-0 ${tier.colorCls}`}>
                          {tier.label}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-surface-2 overflow-hidden">
                          <div
                            className={`${tier.barCls} h-full transition-all duration-300`}
                            style={{ width: `${tier.closed > 0 ? tier.winRate : 0}%` }}
                          />
                        </div>
                        <span className="w-28 text-right tabular-nums text-text-secondary flex-shrink-0">
                          {tier.closed > 0 ? `${tier.winRate.toFixed(0)}%` : '—'}{' '}
                          <span className={tier.totalPnl >= 0 ? 'text-up' : 'text-down'}>
                            ({tier.totalPnl >= 0 ? '+' : ''}{tier.totalPnl.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (5 cols): Ticker & Strategy Attribution Matrix */}
          <div className="lg:col-span-5 rounded-xl border border-surface-border bg-surface-1 p-4 flex flex-col max-h-[440px]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  Attribution Breakdown
                </h2>
                <p className="text-xs text-text-muted">
                  Click ✓ to include or mute a ticker/strategy
                </p>
              </div>

              <div className="flex items-center rounded-lg border border-surface-border bg-surface p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setBreakdownMode('ticker')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    breakdownMode === 'ticker'
                      ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40'
                      : 'text-text-muted hover:text-text-secondary border border-transparent'
                  }`}
                >
                  By Ticker
                </button>
                <button
                  type="button"
                  onClick={() => setBreakdownMode('flat')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    breakdownMode === 'flat'
                      ? 'bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/40'
                      : 'text-text-muted hover:text-text-secondary border border-transparent'
                  }`}
                >
                  Leaderboard
                </button>
              </div>
            </div>

            {/* MODE A: GROUPED BY TICKER */}
            {breakdownMode === 'ticker' ? (
              <div className="space-y-2.5 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                {tickerGroups.map((group) => {
                  const stratIds    = group.strategies.map((s) => s.strategyId);
                  const allExcluded = stratIds.every((id) => excludedStrategySet.has(id));
                  const isCollapsed = collapsedTickers.has(group.symbol);

                  return (
                    <div
                      key={group.symbol}
                      className="rounded-lg border border-surface-border bg-surface overflow-hidden"
                    >
                      {/* High-contrast Ticker Group Header */}
                      <div className="flex items-center justify-between px-3 py-2 bg-surface-2 border-l-4 border-l-amber-400 border-b border-surface-border">
                        <div className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleMuteTickerGroup(stratIds)}
                            title={allExcluded ? 'Include all strategies in this ticker' : 'Mute all strategies in this ticker'}
                            className={`inline-flex items-center justify-center w-4 h-4 rounded border text-xs flex-shrink-0 ${
                              !allExcluded
                                ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                                : 'border-surface-border bg-surface text-transparent'
                            }`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleTickerCollapse(group.symbol)}
                            className="flex items-center gap-2 text-left min-w-0"
                          >
                            <span className={`text-xs text-text-secondary transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}>
                              ▾
                            </span>
                            <span className="text-xs font-bold tracking-wide text-amber-300 truncate">
                              {group.symbol}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-3 text-xs text-text-secondary flex-shrink-0">
                              {group.strategies.length} {group.strategies.length === 1 ? 'strat' : 'strats'} · {group.totalSigs} sigs
                            </span>
                          </button>
                        </div>

                        <div className="flex items-center gap-3 text-xs tabular-nums flex-shrink-0">
                          <span className={group.winRate >= 50 ? 'text-up font-semibold' : 'text-text-muted'}>
                            {group.closedSigs > 0 ? `${group.winRate.toFixed(0)}% WR` : '—'}
                          </span>
                          <span className={`font-bold w-16 text-right ${group.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                            {group.totalPnl !== 0
                              ? `${group.totalPnl >= 0 ? '+' : ''}${group.totalPnl.toFixed(1)}%`
                              : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Strategies inside Ticker Group */}
                      {!isCollapsed && (
                        <div className="divide-y divide-surface-border/60 text-xs">
                          {group.strategies.map((row) => {
                            const isExcluded = excludedStrategySet.has(row.strategyId);
                            return (
                              <div
                                key={row.strategyId}
                                onClick={() => toggleMuteStrategy(row.strategyId)}
                                className={`flex items-center justify-between px-3 py-2 hover:bg-surface-2 cursor-pointer transition-opacity ${
                                  isExcluded ? 'opacity-40' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <span
                                    className={`inline-flex items-center justify-center w-4 h-4 rounded border text-xs flex-shrink-0 ${
                                      !isExcluded
                                        ? 'border-blue-500/50 bg-blue-500/20 text-blue-400'
                                        : 'border-surface-border bg-surface text-transparent'
                                    }`}
                                  >
                                    ✓
                                  </span>
                                  <span className={`truncate text-text-primary ${isExcluded ? 'line-through' : ''}`}>
                                    {row.strategyName}
                                  </span>
                                  <span className="text-text-muted flex-shrink-0">· {row.timeframe}</span>
                                </div>
                                <div className="flex items-center gap-3 tabular-nums flex-shrink-0">
                                  <span className="text-text-muted">{row.total} sigs</span>
                                  <span className={row.winRate >= 50 ? 'text-up' : 'text-text-muted'}>
                                    {row.closed > 0 ? `${row.winRate.toFixed(0)}%` : '—'}
                                  </span>
                                  <span className={`font-semibold w-14 text-right ${row.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                                    {row.totalPnl !== 0
                                      ? `${row.totalPnl >= 0 ? '+' : ''}${row.totalPnl.toFixed(1)}%`
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* MODE B: FLAT LEADERBOARD */
              <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 scrollbar-thin text-xs">
                {breakdown.map((row) => {
                  const isExcluded = excludedStrategySet.has(row.strategyId);
                  return (
                    <div
                      key={row.strategyId}
                      onClick={() => toggleMuteStrategy(row.strategyId)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border border-surface-border bg-surface hover:bg-surface-2 cursor-pointer transition-opacity ${
                        isExcluded ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span
                          className={`inline-flex items-center justify-center w-4 h-4 rounded border text-xs flex-shrink-0 ${
                            !isExcluded
                              ? 'border-blue-500/50 bg-blue-500/20 text-blue-400'
                              : 'border-surface-border bg-surface text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold flex-shrink-0">
                          {row.symbol}
                        </span>
                        <span className={`font-semibold text-text-primary truncate ${isExcluded ? 'line-through' : ''}`}>
                          {row.strategyName}
                        </span>
                        <span className="text-text-muted flex-shrink-0">· {row.timeframe}</span>
                      </div>
                      <div className="flex items-center gap-3 tabular-nums flex-shrink-0">
                        <span className={row.winRate >= 50 ? 'text-up' : 'text-text-muted'}>
                          {row.closed > 0 ? `${row.winRate.toFixed(0)}% WR` : '—'}
                        </span>
                        <span className={`font-bold w-16 text-right ${row.totalPnl >= 0 ? 'text-up' : 'text-down'}`}>
                          {row.totalPnl !== 0
                            ? `${row.totalPnl >= 0 ? '+' : ''}${row.totalPnl.toFixed(1)}%`
                            : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 4. BOTTOM LEDGER: SIGNAL & TRADE FEED WITH TICKER PILLS ──────── */}
        <div className="rounded-xl border border-surface-border bg-surface-1 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Signal &amp; Trade Execution Ledger
              </h2>
              <p className="text-xs text-text-muted">
                Click any ticker pill to isolate a symbol, or click a signal row to inspect confluence &amp; record fills
              </p>
            </div>

            {/* Search & Outcome Filter Controls */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="text"
                placeholder="Strategy, sig#ID, strat_ID…"
                value={filterStrategy}
                onChange={(e) => setFilterStrategy(e.target.value)}
                className="rounded-lg border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary placeholder:text-text-muted/60 outline-none focus:border-blue-500/60 w-48"
              />
              <select
                value={filterDir}
                onChange={(e) => setFilterDir(e.target.value as 'all' | 'long' | 'short')}
                className="rounded-lg border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none focus:border-blue-500/60 cursor-pointer"
              >
                <option value="all">All Directions</option>
                <option value="long">▲ Long Only</option>
                <option value="short">▼ Short Only</option>
              </select>
              <select
                value={filterOutcome}
                onChange={(e) => setFilterOutcome(e.target.value as 'all' | 'open' | 'win' | 'loss')}
                className="rounded-lg border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary outline-none focus:border-blue-500/60 cursor-pointer"
              >
                <option value="all">All Outcomes</option>
                <option value="open">Open / In Trade</option>
                <option value="win">Wins (+)</option>
                <option value="loss">Losses (-)</option>
              </select>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterStrategy('');
                    setFilterSymbol('ALL');
                    setFilterDir('all');
                    setFilterOutcome('all');
                  }}
                  className="rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  ✕ Clear
                </button>
              )}
              <span className="text-xs text-text-muted ml-1">
                {filteredSignals.length} / {baseLedger.length}
              </span>
            </div>
          </div>

          {/* Quick Ticker Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-text-muted mr-1">Ticker:</span>
            <button
              type="button"
              onClick={() => setFilterSymbol('ALL')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
                filterSymbol === 'ALL'
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                  : 'border-surface-border bg-surface text-text-secondary hover:border-amber-500/40'
              }`}
            >
              ALL ({baseLedger.length})
            </button>
            {ledgerTickerCounts.map(([sym, count]) => {
              const active = filterSymbol === sym;
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setFilterSymbol(active ? 'ALL' : sym)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
                    active
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                      : 'border-surface-border bg-surface text-text-primary hover:border-amber-500/40'
                  }`}
                >
                  {sym} <span className="text-text-muted font-normal">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Ledger Table */}
          <div className="overflow-x-auto rounded-lg border border-surface-border">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-surface text-text-muted uppercase border-b border-surface-border">
                  <th className="text-left py-2.5 px-3 font-semibold">Ticker / Dir</th>
                  <th className="text-left py-2.5 px-3 font-semibold">Strategy</th>
                  <th className="text-left py-2.5 px-2 font-semibold">Grade</th>
                  <th className="text-left py-2.5 px-2 font-semibold">AI Verdict</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Sig / Limit Entry</th>
                  <th className="text-right py-2.5 px-3 font-semibold">TP / SL Plan</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Outcome / P&amp;L</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Fired</th>
                  <th className="text-right py-2.5 px-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border/60">
                {filteredSignals.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-xs text-text-muted">
                      No signals match the current filters.
                    </td>
                  </tr>
                )}
                {filteredSignals.map((s) => {
                  const isUnfilled = s.pnl_pct === null && (s.outcome_note?.includes('Limit unfilled') ?? false);
                  const pnlCls =
                    s.pnl_pct === null
                      ? s.actual_entry_price !== null
                        ? 'text-blue-400'
                        : 'text-text-muted'
                      : s.pnl_pct > 0
                      ? 'text-up'
                      : 'text-down';

                  const pnlLabel =
                    s.pnl_pct === null && s.actual_entry_price !== null
                      ? 'in trade'
                      : isUnfilled
                      ? 'unfilled'
                      : s.pnl_pct === null
                      ? 'open'
                      : `${s.pnl_pct >= 0 ? '+' : ''}${s.pnl_pct.toFixed(2)}%`;

                  const isEditing = editingId === s.id;
                  const effRating = effectiveSignalRating(s);
                  const gradeInfo = ratingToGrade(effRating);
                  const ai        = s.ai_evaluation;

                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => setEditingId(isEditing ? null : s.id)}
                        className={`hover:bg-surface-2 cursor-pointer transition-colors ${
                          isEditing ? 'bg-surface-2' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
                              {s.symbol}
                            </span>
                            <span className={`font-bold ${s.direction === 'long' ? 'text-up' : 'text-down'}`}>
                              {s.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[200px] truncate" title={`${s.strategy_name} (${s.strategy_id})`}>
                          <span className="text-text-muted mr-1.5">#{s.id}</span>
                          <span className="font-semibold text-text-primary">{s.strategy_name}</span>
                          <span className="text-text-muted ml-1">· {s.timeframe}</span>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span
                            className={`inline-block rounded border px-1.5 py-0.5 text-xs font-bold leading-tight ${gradeInfo.badgeClass}`}
                            title={`Signal Rating: ${effRating}/7 stars`}
                          >
                            {gradeInfo.grade}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          {ai ? (
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 text-xs font-semibold leading-tight ${
                                ai.status === 'PASS'
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                  : ai.status === 'CAVEAT'
                                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                  : 'border-red-500/30 bg-red-500/10 text-red-400'
                              }`}
                              title={ai.summary}
                            >
                              {ai.status}
                              {ai.metrics?.technicalScore != null ? ` (${ai.metrics.technicalScore})` : ''}
                            </span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          <div className="text-text-price">{fmtPx(s.entry_price)}</div>
                          {s.entry_price_limit != null && (
                            <div className="text-text-muted">Lim: {fmtPx(s.entry_price_limit)}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                          <span className="text-up">+{s.take_profit_pct}%</span>
                          <span className="text-text-muted"> / </span>
                          <span className="text-down">-{s.stop_loss_pct}%</span>
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums font-bold whitespace-nowrap ${pnlCls}`}
                          title={s.outcome_note ?? undefined}
                        >
                          {pnlLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right text-text-muted tabular-nums whitespace-nowrap">
                          {format(new Date(s.fired_at), 'MM/dd HH:mm')}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(isEditing ? null : s.id);
                            }}
                            className={`px-2 py-0.5 rounded border text-xs transition-colors ${
                              isEditing
                                ? 'border-blue-500/40 bg-blue-500/15 text-blue-400'
                                : s.actual_entry_price !== null
                                ? 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10'
                                : 'border-surface-border text-text-muted hover:text-text-primary'
                            }`}
                          >
                            {isEditing ? 'Close ▴' : 'Inspect ▾'}
                          </button>
                        </td>
                      </tr>

                      {isEditing && (
                        <SignalInspectorDrawer
                          signal={s}
                          colSpan={9}
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
    </div>
  );
}
