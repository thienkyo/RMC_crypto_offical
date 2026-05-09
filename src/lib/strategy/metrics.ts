/**
 * Backtest performance metrics.
 *
 * All ratio calculations use bar-level returns from the equity curve.
 * Annualisation factor: sqrt(365) — crypto trades 24/7/365.
 * Risk-free rate: 0 (personal tool; keeps formula simple and comparable).
 */

import type { BacktestTrade, BacktestMetrics, EquityPoint } from '@/types/strategy';

const ANNUALISE = Math.sqrt(365);

function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : 0;
}

function sampleStddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Annualised Sharpe ratio.
 * Uses daily bar returns; for sub-daily timeframes this is approximate
 * (over-annualises) but consistent and easy to compare across strategies.
 */
function sharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = mean(returns);
  const std = sampleStddev(returns, avg);
  return std === 0 ? 0 : (avg / std) * ANNUALISE;
}

/**
 * Annualised Sortino ratio.
 * Penalises only downside volatility — more appropriate for trading systems
 * where upside variance is desirable.
 */
function sortino(returns: number[]): number {
  if (returns.length < 2) return 0;
  const avg = mean(returns);
  const downsideReturns = returns.filter((r) => r < 0);
  if (downsideReturns.length === 0) return avg > 0 ? Infinity : 0;

  // RMS of downside deviations (semi-deviation)
  const downstddev = Math.sqrt(
    downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length,
  );
  return downstddev === 0 ? 0 : (avg / downstddev) * ANNUALISE;
}

/** Maximum peak-to-trough drawdown as a percentage of peak equity. */
function maxDrawdown(equityCurve: EquityPoint[], initialCapital: number): number {
  let peak = initialCapital;
  let maxDD = 0;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = peak > 0 ? ((peak - point.value) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityPoint[],
  initialCapital: number,
): BacktestMetrics {
  const finalCapital =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1]!.value
      : initialCapital;

  const wins   = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);

  const grossProfit = wins.reduce((s, t) => s + Math.max(t.pnlAbs, 0), 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + Math.min(t.pnlAbs, 0), 0));

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;

  // Bar-level percentage returns for ratio calculations
  const barReturns = equityCurve.slice(1).map((p, i) => {
    const prev = equityCurve[i]!.value;
    return prev > 0 ? (p.value - prev) / prev : 0;
  });

  return {
    totalReturnPct:
      initialCapital > 0
        ? ((finalCapital - initialCapital) / initialCapital) * 100
        : 0,
    totalTrades:   trades.length,
    winningTrades: wins.length,
    losingTrades:  losses.length,
    winRatePct:
      trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWinPct:
      wins.length > 0
        ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length
        : 0,
    avgLossPct:
      losses.length > 0
        ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length
        : 0,
    profitFactor,
    maxDrawdownPct: maxDrawdown(equityCurve, initialCapital),
    sharpeRatio:    sharpe(barReturns),
    sortinoRatio:   sortino(barReturns),
    initialCapital,
    finalCapital,
  };
}
