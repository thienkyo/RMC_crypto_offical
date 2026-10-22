/**
 * Pure portfolio analytics and aggregation helpers for PortfolioOverview.
 *
 * Client-safe (zero server-side imports).
 */

import { computeSignalMetrics, type StrategySignalRow } from '@/lib/strategy/signalMetrics';
import { signalScore } from '@/lib/strategy/rating';

export interface StrategyBreakdown {
  strategyId:   string;
  strategyName: string;
  symbol:       string;
  timeframe:    string;
  total:        number;
  closed:       number;
  taken:        number;
  wins:         number;
  losses:       number;
  winRate:      number;
  totalPnl:     number;
}

export interface TickerGroupBreakdown {
  symbol:     string;
  strategies: StrategyBreakdown[];
  totalSigs:  number;
  closedSigs: number;
  wins:       number;
  losses:     number;
  winRate:    number;
  totalPnl:   number;
}

export interface EquityCurvePoint {
  time:     number;
  value:    number;
  peak:     number;
  drawdown: number;
}

export interface DirectionalStats {
  total:    number;
  closed:   number;
  wins:     number;
  winRate:  number;
  totalPnl: number;
}

export interface AiAttributionStats {
  evaluatedCount:      number;
  passCount:           number;
  passWinRate:         number;
  rejectedCount:       number;
  rejectedClosedCount: number;
  rejectedLossesCount: number;
  savedLossPct:        number;
}

export interface GradeTierStats {
  id:       string;
  label:    string;
  colorCls: string;
  barCls:   string;
  total:    number;
  closed:   number;
  winRate:  number;
  totalPnl: number;
}

export interface ExtendedPortfolioMetrics {
  peakPnl:            number;
  maxDrawdown:        number;
  profitFactor:       number | null;
  expectancy:         number;
  unfilledCount:      number;
  takenManuallyCount: number;
  longStats:          DirectionalStats;
  shortStats:         DirectionalStats;
  aiStats:            AiAttributionStats;
  gradeTiers:         GradeTierStats[];
}

export function effectiveSignalRating(s: StrategySignalRow): number {
  if (typeof s.rating === 'number') return s.rating;
  if (s.conditions_snapshot && s.conditions_snapshot.length > 0) {
    return signalScore(s.conditions_snapshot);
  }
  return 4;
}

export function buildEquityPoints(signals: StrategySignalRow[]): EquityCurvePoint[] {
  const closed = signals
    .filter((s) => s.pnl_pct !== null && s.outcome_at !== null)
    .sort((a, b) => a.outcome_at! - b.outcome_at!);
  if (closed.length === 0) return [];

  let cum  = 0;
  let peak = 0;

  return closed.map((s) => {
    cum += s.pnl_pct!;
    if (cum > peak) peak = cum;
    const dd = cum - peak; // <= 0
    return {
      time:     s.outcome_at!,
      value:    parseFloat(cum.toFixed(2)),
      peak:     parseFloat(peak.toFixed(2)),
      drawdown: parseFloat(dd.toFixed(2)),
    };
  });
}

export function buildPnlBuckets(
  signals: StrategySignalRow[],
): { label: string; count: number; positive: boolean }[] {
  const pnls = signals.filter((s) => s.pnl_pct !== null).map((s) => s.pnl_pct!);
  if (pnls.length === 0) return [];
  const min = Math.floor(Math.min(...pnls) / 2) * 2;
  const max = Math.ceil(Math.max(...pnls) / 2) * 2;
  const buckets = new Map<number, number>();
  for (let lo = min; lo <= max; lo += 2) buckets.set(lo, 0);
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

export function buildBreakdown(signals: StrategySignalRow[]): StrategyBreakdown[] {
  const map = new Map<string, StrategySignalRow[]>();
  for (const s of signals) {
    const arr = map.get(s.strategy_id) ?? [];
    arr.push(s);
    map.set(s.strategy_id, arr);
  }
  return Array.from(map.values())
    .map((rows) => {
      const m     = computeSignalMetrics(rows);
      const taken = rows.filter((r) => r.actual_entry_price !== null).length;
      return {
        strategyId:   rows[0]!.strategy_id,
        strategyName: rows[0]!.strategy_name,
        symbol:       rows[0]!.symbol,
        timeframe:    rows[0]!.timeframe,
        total:        m.total,
        closed:       m.wins + m.losses,
        taken,
        wins:         m.wins,
        losses:       m.losses,
        winRate:      m.winRate,
        totalPnl:     m.totalPnl,
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

export function buildTickerGroups(breakdown: StrategyBreakdown[]): TickerGroupBreakdown[] {
  const map = new Map<string, StrategyBreakdown[]>();
  for (const row of breakdown) {
    const list = map.get(row.symbol) ?? [];
    list.push(row);
    map.set(row.symbol, list);
  }

  return Array.from(map.entries())
    .map(([symbol, strategies]) => {
      const totalSigs  = strategies.reduce((acc, s) => acc + s.total, 0);
      const wins       = strategies.reduce((acc, s) => acc + s.wins, 0);
      const losses     = strategies.reduce((acc, s) => acc + s.losses, 0);
      const closedSigs = wins + losses;
      const winRate    = closedSigs > 0 ? (wins / closedSigs) * 100 : 0;
      const totalPnl   = strategies.reduce((acc, s) => acc + s.totalPnl, 0);
      return {
        symbol,
        strategies: [...strategies].sort((a, b) => b.totalPnl - a.totalPnl),
        totalSigs,
        closedSigs,
        wins,
        losses,
        winRate,
        totalPnl,
      };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

function computeDirStats(rows: StrategySignalRow[]): DirectionalStats {
  const closed   = rows.filter((s) => s.pnl_pct !== null);
  const wins     = closed.filter((s) => s.pnl_pct! > 0);
  const winRate  = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalPnl = closed.reduce((sum, s) => sum + s.pnl_pct!, 0);
  return {
    total:    rows.length,
    closed:   closed.length,
    wins:     wins.length,
    winRate,
    totalPnl,
  };
}

export function computeExtendedPortfolioMetrics(
  rangedSignals: StrategySignalRow[],
  dateWindowSignals: StrategySignalRow[],
): ExtendedPortfolioMetrics {
  const curve       = buildEquityPoints(rangedSignals);
  const peakPnl     = curve.reduce((max, pt) => Math.max(max, pt.peak), 0);
  const maxDrawdown = curve.reduce((min, pt) => Math.min(min, pt.drawdown), 0);

  const closed      = rangedSignals.filter((s) => s.pnl_pct !== null);
  const grossProfit = closed.filter((s) => s.pnl_pct! > 0).reduce((acc, s) => acc + s.pnl_pct!, 0);
  const grossLoss   = closed.filter((s) => s.pnl_pct! < 0).reduce((acc, s) => acc + Math.abs(s.pnl_pct!), 0);

  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : null;
  const expectancy =
    closed.length > 0
      ? closed.reduce((acc, s) => acc + s.pnl_pct!, 0) / closed.length
      : 0;

  const unfilledCount = rangedSignals.filter(
    (s) => s.pnl_pct === null && (s.outcome_note?.includes('Limit unfilled') ?? false),
  ).length;
  const takenManuallyCount = rangedSignals.filter((s) => s.actual_entry_price !== null).length;

  const longStats  = computeDirStats(rangedSignals.filter((s) => s.direction === 'long'));
  const shortStats = computeDirStats(rangedSignals.filter((s) => s.direction === 'short'));

  // AI Gatekeeper attribution across the active date window
  const evaluated = dateWindowSignals.filter((s) => s.ai_evaluation != null);
  const passed    = evaluated.filter((s) => s.ai_evaluation?.status === 'PASS');
  const passedClosed = passed.filter((s) => s.pnl_pct !== null);
  const passedWins   = passedClosed.filter((s) => s.pnl_pct! > 0);
  const passWinRate  = passedClosed.length > 0 ? (passedWins.length / passedClosed.length) * 100 : 0;

  const rejected       = evaluated.filter((s) => s.ai_evaluation?.status === 'REJECT');
  const rejectedClosed = rejected.filter((s) => s.pnl_pct !== null);
  const rejectedLosses = rejectedClosed.filter((s) => s.pnl_pct! < 0);
  const savedLossPct   = rejectedLosses.reduce((acc, s) => acc + Math.abs(s.pnl_pct!), 0);

  // Confluence Grade tiers
  const tierDefs = [
    {
      id:       'aplus',
      label:    'A+ (7★)',
      colorCls: 'text-emerald-400',
      barCls:   'bg-emerald-400',
      match:    (r: number) => r >= 7,
    },
    {
      id:       'a_bplus',
      label:    'A / B+',
      colorCls: 'text-blue-400',
      barCls:   'bg-blue-400',
      match:    (r: number) => r >= 5 && r < 7,
    },
    {
      id:       'b_below',
      label:    'B & C',
      colorCls: 'text-amber-400',
      barCls:   'bg-amber-400',
      match:    (r: number) => r < 5,
    },
  ];

  const gradeTiers: GradeTierStats[] = tierDefs.map((t) => {
    const matching = rangedSignals.filter((s) => t.match(effectiveSignalRating(s)));
    const stats    = computeDirStats(matching);
    return {
      id:       t.id,
      label:    t.label,
      colorCls: t.colorCls,
      barCls:   t.barCls,
      total:    stats.total,
      closed:   stats.closed,
      winRate:  stats.winRate,
      totalPnl: stats.totalPnl,
    };
  });

  return {
    peakPnl,
    maxDrawdown,
    profitFactor,
    expectancy,
    unfilledCount,
    takenManuallyCount,
    longStats,
    shortStats,
    aiStats: {
      evaluatedCount:      evaluated.length,
      passCount:           passed.length,
      passWinRate,
      rejectedCount:       rejected.length,
      rejectedClosedCount: rejectedClosed.length,
      rejectedLossesCount: rejectedLosses.length,
      savedLossPct,
    },
    gradeTiers,
  };
}
