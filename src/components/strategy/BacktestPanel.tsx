'use client';

/**
 * BacktestPanel — displays backtest results with a run history selector.
 *
 * Props:
 *   history  — all saved runs for this strategy (newest-first).
 *
 * The top bar has a run picker (dropdown) so the user can switch between
 * past runs without re-running the backtest.
 *
 * Three tabs per run:
 *   Overview  — equity curve + key metric cards
 *   Metrics   — full metric table
 *   Trades    — trade log
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { EquityCurve } from './EquityCurve';
import type { BacktestResult, BacktestTrade } from '@/types/strategy';

type Tab = 'overview' | 'metrics' | 'trades';

interface Props {
  /** All saved runs, newest-first. Must be non-empty. */
  history: BacktestResult[];
  /** Called when the user wants to clear all history for this strategy. */
  onClearHistory?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Null-safe formatters — stale Zustand persistence can leave metric fields as
// null/undefined when the schema changes between app versions.
function fmt2(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(2);
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}
function colourPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return 'text-text-muted';
  return n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-text-muted';
}

/** Short label for a run in the picker. */
function runLabel(r: BacktestResult, index: number): string {
  const date   = format(new Date(r.ranAt), 'dd MMM HH:mm');
  const ret    = fmtPct(r.metrics.totalReturnPct);
  const trades = r.metrics.totalTrades;
  const latest = index === 0 ? ' · latest' : '';
  return `${date}  ${ret}  ${trades} trades${latest}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div className="rounded border border-surface-border bg-surface-2 p-3">
      <div className="text-xs text-text-muted mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-semibold ${colour ?? 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

function TradeRow({ trade }: { trade: BacktestTrade }) {
  return (
    <tr className="border-t border-surface-border text-xs font-mono hover:bg-surface-2">
      <td className="py-1.5 px-2 text-text-muted">{trade.id}</td>
      <td className="py-1.5 px-2">
        <span className={trade.direction === 'long' ? 'text-green-400' : 'text-red-400'}>
          {trade.direction.toUpperCase()}
        </span>
      </td>
      <td className="py-1.5 px-2 text-text-muted">
        {format(new Date(trade.entryTime), 'dd MMM HH:mm')}
      </td>
      <td className="py-1.5 px-2 text-text-muted">
        {format(new Date(trade.exitTime), 'dd MMM HH:mm')}
      </td>
      <td className="py-1.5 px-2">{fmt2(trade.entryPrice)}</td>
      <td className="py-1.5 px-2">{fmt2(trade.exitPrice)}</td>
      <td className={`py-1.5 px-2 ${colourPct(trade.pnlPct)}`}>{fmtPct(trade.pnlPct)}</td>
      <td className={`py-1.5 px-2 ${colourPct(trade.pnlAbs)}`}>
        {trade.pnlAbs >= 0 ? '+' : ''}{fmt2(trade.pnlAbs)}
      </td>
      <td className="py-1.5 px-2 text-text-muted capitalize">
        {trade.exitReason.replace('_', ' ')}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BacktestPanel({ history, onClearHistory }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab,     setActiveTab]     = useState<Tab>('overview');

  // If history shrinks (e.g. after a clear), clamp the selected index
  const safeIndex = Math.min(selectedIndex, history.length - 1);
  const result    = history[safeIndex]!;
  const { metrics, trades, equityCurve } = result;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics',  label: 'Metrics' },
    { id: 'trades',   label: `Trades (${trades.length})` },
  ];

  return (
    <div className="flex flex-col h-full">

      {/* ── Run picker ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-surface-border px-3 py-2 flex items-center gap-2">
        <span className="text-[10px] text-text-secondary font-mono whitespace-nowrap">
          RUN
        </span>
        <select
          value={safeIndex}
          onChange={(e) => {
            setSelectedIndex(Number(e.target.value));
            setActiveTab('overview');
          }}
          className="flex-1 min-w-0 select-sm text-[11px] font-mono"
        >
          {history.map((r, i) => (
            <option key={r.ranAt} value={i}>
              {runLabel(r, i)}
            </option>
          ))}
        </select>

        {/* Clear history button */}
        {onClearHistory && history.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete all ${history.length} saved run(s) for this strategy?`)) {
                onClearHistory();
              }
            }}
            className="btn-icon-xs text-text-muted hover:text-red-400 flex-shrink-0"
            title="Clear run history"
          >
            🗑
          </button>
        )}
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-1 border-b border-surface-border px-3 py-1.5">
        <span className="text-[10px] text-text-muted font-mono mr-2">
          {format(new Date(result.startTime), 'dd MMM yyyy')} →{' '}
          {format(new Date(result.endTime),   'dd MMM yyyy')}
          {' · '}{result.symbol} {result.timeframe}
        </span>
        <div className="ml-auto flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`tab-btn ${activeTab === t.id ? 'tab-btn-active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Zero-trades banner */}
        {trades.length === 0 && (
          <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 space-y-1">
            <p className="font-semibold">No trades fired over this period.</p>
            <p>Common causes:</p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-300/80">
              <li>
                <strong>BB band threshold is a raw price</strong> — "Middle Band &lt; 30"
                means $30 USDT. For BTCUSDT the band is ~$90k+. Use{' '}
                <strong>BB %B</strong> instead (0 = lower band, 1 = upper band).
              </li>
              <li>
                Threshold is outside the indicator's actual range. Open the browser
                console — the backtest logs the exact value range vs. your threshold.
              </li>
              <li>Entry condition group is empty (no conditions added).</li>
            </ul>
          </div>
        )}

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <EquityCurve data={equityCurve} initialCapital={metrics.initialCapital} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard
                label="Total Return"
                value={fmtPct(metrics.totalReturnPct)}
                colour={colourPct(metrics.totalReturnPct)}
              />
              <MetricCard label="Win Rate"     value={`${fmt2(metrics.winRatePct)}%`} />
              <MetricCard
                label="Max Drawdown"
                value={`-${fmt2(metrics.maxDrawdownPct)}%`}
                colour="text-red-400"
              />
              <MetricCard
                label="Profit Factor"
                value={metrics.profitFactor === Infinity ? '∞' : fmt2(metrics.profitFactor)}
                colour={metrics.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard label="Total Trades" value={String(metrics.totalTrades)} />
              <MetricCard label="Sharpe Ratio" value={fmt2(metrics.sharpeRatio)} />
              <MetricCard
                label="Sortino Ratio"
                value={metrics.sortinoRatio === Infinity ? '∞' : fmt2(metrics.sortinoRatio)}
              />
              <MetricCard
                label="Final Capital"
                value={`$${metrics.finalCapital.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              />
            </div>
          </div>
        )}

        {/* Full metrics */}
        {activeTab === 'metrics' && (
          <table className="w-full text-xs font-mono">
            <tbody>
              {([
                ['Total Return',    fmtPct(metrics.totalReturnPct),  colourPct(metrics.totalReturnPct)],
                ['Initial Capital', `$${metrics.initialCapital.toLocaleString()}`, ''],
                ['Final Capital',   `$${metrics.finalCapital.toLocaleString('en-US', { maximumFractionDigits: 2 })}`, colourPct(metrics.finalCapital - metrics.initialCapital)],
                ['Total Trades',    String(metrics.totalTrades), ''],
                ['Winning Trades',  `${metrics.winningTrades} (${fmt2(metrics.winRatePct)}%)`, 'text-green-400'],
                ['Losing Trades',   String(metrics.losingTrades), 'text-red-400'],
                ['Avg Win',         fmtPct(metrics.avgWinPct), 'text-green-400'],
                ['Avg Loss',        fmtPct(metrics.avgLossPct), 'text-red-400'],
                ['Profit Factor',   metrics.profitFactor === Infinity ? '∞' : fmt2(metrics.profitFactor), metrics.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'],
                ['Max Drawdown',    `-${fmt2(metrics.maxDrawdownPct)}%`, 'text-red-400'],
                ['Sharpe Ratio',    fmt2(metrics.sharpeRatio), ''],
                ['Sortino Ratio',   metrics.sortinoRatio === Infinity ? '∞' : fmt2(metrics.sortinoRatio), ''],
              ] as [string, string, string][]).map(([label, value, colour]) => (
                <tr key={label} className="border-t border-surface-border">
                  <td className="py-2 pr-4 text-text-muted">{label}</td>
                  <td className={`py-2 font-semibold ${colour}`}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Trade list */}
        {activeTab === 'trades' && (
          trades.length === 0 ? (
            <p className="text-xs text-text-muted italic">No trades generated.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="text-xs text-text-muted">
                    {['#', 'Dir', 'Entry Time', 'Exit Time', 'Entry $', 'Exit $', 'P&L %', 'P&L $', 'Exit Reason'].map(
                      (h) => <th key={h} className="py-1.5 px-2 text-left font-normal">{h}</th>,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...trades].sort((a, b) => b.entryTime - a.entryTime).map((t) => <TradeRow key={t.id} trade={t} />)}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
