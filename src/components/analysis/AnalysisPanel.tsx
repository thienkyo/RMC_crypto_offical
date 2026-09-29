'use client';

/**
 * AnalysisPanel — Unified AI Copilot (Decision Evaluator & Chart Vision).
 *
 * Merges visual canvas screenshot analysis with quantitative technical indicators
 * (37+ indicators, RSI divergence, MACD, Volume Profile POC) and multi-channel
 * sentiment (Telegram, Google News, YouTube, X, Tech News) into a single,
 * cohesive trading decision workflow.
 *
 * Gatekeeper Verdicts: PASS 🟢 | CAVEAT 🟡 | REJECT 🔴
 *
 * Auto-Restore & History Behavior:
 * - Shows latest result automatically if it is within 3 days (72 hours).
 * - If older than 3 days, displays clean setup form by default.
 * - Clicking "📜 History" displays all historical evaluations for instant reference.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useChartStore } from '@/store/chart';
import type {
  AnalyzeChartResponse,
  ChartAnalysis,
  TrendDirection,
  Bias,
} from '@/lib/ai/types';
import type {
  OrderEvaluationResult,
  EvaluatorProvider,
  EvaluationStatus,
} from '@/lib/ai/evaluator/types';
import type { AiHistoryItem } from '@/app/api/ai/history/route';

// ─── Theme & Styling Config ──────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  EvaluationStatus,
  { label: string; bg: string; text: string; border: string; icon: string }
> = {
  PASS: {
    label: 'PASS — HIGH CONFLUENCE',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/30',
    icon: '✓',
  },
  CAVEAT: {
    label: 'CAVEAT — PROCEED WITH CAUTION',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/30',
    icon: '⚠️',
  },
  REJECT: {
    label: 'REJECT — UNFAVORABLE SETUP',
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/30',
    icon: '✕',
  },
};

const TREND_COLORS: Record<TrendDirection, string> = {
  bullish:  'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  bearish:  'text-rose-400 border-rose-500/30 bg-rose-500/10',
  sideways: 'text-text-secondary border-surface-border bg-surface-2',
};

const BIAS_COLORS: Record<Bias, string> = {
  long:    'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  short:   'text-rose-400 bg-rose-500/10 border-rose-500/30',
  neutral: 'text-text-secondary bg-surface-2 border-surface-border',
};

const STRENGTH_LABELS: Record<string, string> = {
  strong:   '●●● High',
  moderate: '●●○ Moderate',
  weak:     '●○○ Weak',
};

const CONF_COLORS: Record<string, string> = {
  high:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  low:    'text-text-muted bg-surface-2 border-surface-border',
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function formatTimeAgo(dateString: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function isWithin3Days(dateString: string): boolean {
  return Date.now() - new Date(dateString).getTime() <= THREE_DAYS_MS;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function VisualTrendCard({ analysis }: { analysis: ChartAnalysis }) {
  const { direction, strength, summary } = analysis.trend;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
          📈 Visual Chart Trend & Bias
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${BIAS_COLORS[analysis.bias]}`}>
            Bias: {analysis.bias}
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${TREND_COLORS[direction]}`}>
            {direction} ({STRENGTH_LABELS[strength] ?? strength})
          </span>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed">
        {summary}
      </p>
    </div>
  );
}

function KeyLevelsTable({ levels }: { levels: ChartAnalysis['key_levels'] }) {
  if (!levels || levels.length === 0) return null;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
          🎯 Key Support & Resistance (Vision)
        </span>
        <span className="text-[9px] font-mono text-text-muted">
          {levels.length} levels detected
        </span>
      </div>
      <div className="flex flex-col gap-1 pt-1">
        {levels.map((lvl, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-[11px] font-mono py-1 px-1.5 rounded bg-surface-2/60 border border-surface-border/40"
          >
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                lvl.type === 'support'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {lvl.type === 'support' ? 'SUP' : 'RES'}
            </span>
            <span className="text-text-price font-bold min-w-[70px]">
              ${lvl.price.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: lvl.price < 1 ? 6 : 2,
              })}
            </span>
            <span className="text-text-muted text-[10px] leading-tight flex-1">
              {lvl.notes}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetectedPatterns({ patterns }: { patterns: ChartAnalysis['patterns'] }) {
  if (!patterns || patterns.length === 0) return null;
  return (
    <div className="p-2.5 rounded-lg border border-surface-border bg-surface flex flex-col gap-1.5">
      <span className="text-[10px] font-mono uppercase font-bold text-text-muted tracking-wider">
        🕯️ Chart & Candlestick Patterns
      </span>
      <div className="flex flex-col gap-1.5 pt-0.5">
        {patterns.map((p, i) => (
          <div key={i} className="text-[11px] p-2 rounded bg-surface-2/60 border border-surface-border/40">
            <div className="flex items-center justify-between mb-1">
              <span className="text-text-primary font-semibold font-mono text-[11px]">{p.name}</span>
              <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded border uppercase font-bold ${CONF_COLORS[p.confidence]}`}>
                {p.confidence} Conf
              </span>
            </div>
            <p className="text-text-muted text-[10px] leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Unified Component ──────────────────────────────────────────────────

interface Props {
  /** Returns a base64 PNG of the current chart canvas, or null if not ready. */
  getScreenshot: () => string | null;
}

export function AnalysisPanel({ getScreenshot }: Props) {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const candles = useChartStore((s) => s.candles);

  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle?.close ?? 0;

  // Form states
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [provider, setProvider] = useState<EvaluatorProvider>('gemini');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [stopLossPct, setStopLossPct] = useState<string>('3.0');
  const [takeProfitPct, setTakeProfitPct] = useState<string>('6.0');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [isSetupOpen, setIsSetupOpen] = useState(true);

  // Result states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [evalResult, setEvalResult] = useState<OrderEvaluationResult | null>(null);
  const [visionResult, setVisionResult] = useState<AnalyzeChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);

  // History states
  const [historyList, setHistoryList] = useState<AiHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeHistoryItem, setActiveHistoryItem] = useState<AiHistoryItem | null>(null);
  const [historyScope, setHistoryScope] = useState<'current' | 'all'>('current');

  const activeEntryPrice = entryPrice ? parseFloat(entryPrice) : currentPrice;

  // Live Risk:Reward ratio calculation
  const rrRatio = useMemo(() => {
    const sl = parseFloat(stopLossPct);
    const tp = parseFloat(takeProfitPct);
    if (!sl || !tp || isNaN(sl) || isNaN(tp) || sl <= 0) return null;
    return (tp / sl).toFixed(2);
  }, [stopLossPct, takeProfitPct]);

  // ── Fetch Evaluation History ───────────────────────────────────────────────
  const fetchHistory = useCallback(async (scope: 'current' | 'all' = historyScope) => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const url = scope === 'current'
        ? `/api/ai/history?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=30`
        : `/api/ai/history?limit=30`;

      const res = await fetch(url);
      if (!res.ok) {
        setHistoryError('Database unreachable — check if Docker / PostgreSQL is running.');
        return;
      }

      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        setHistoryList(data.history);

        // Auto-restore logic:
        // If viewing current symbol and history has an item created <= 3 days ago, show it!
        // If older than 3 days, do not auto-show.
        if (scope === 'current' && data.history.length > 0) {
          const latest = data.history[0] as AiHistoryItem;
          if (isWithin3Days(latest.createdAt)) {
            setActiveHistoryItem(latest);
            setEvalResult(latest.evaluation);
            if (latest.vision?.analysis) {
              setVisionResult({
                analysis: latest.vision.analysis,
                fromCache: true,
                model: latest.vision.model,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[AnalysisPanel] Failed to fetch history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [symbol, timeframe, historyScope]);

  // Load history on mount or when symbol / timeframe change
  useEffect(() => {
    // Reset active historical view when changing symbol
    setActiveHistoryItem(null);
    setEvalResult(null);
    setVisionResult(null);
    setError(null);
    setPartialWarning(null);
    fetchHistory('current');
  }, [symbol, timeframe, fetchHistory]);

  // Unified Parallel Analysis Execution
  const handleAnalyze = useCallback(async () => {
    if (!latestCandle) {
      setError('Market candles are still loading.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setPartialWarning(null);
    setActiveHistoryItem(null); // Clear historical label for a live run

    const imageBase64 = getScreenshot();

    // 1. Order Evaluator (Indicators + News)
    const evalPromise = fetch('/api/ai/evaluate-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        direction,
        entryPrice: activeEntryPrice,
        stopLossPct: stopLossPct ? parseFloat(stopLossPct) : undefined,
        takeProfitPct: takeProfitPct ? parseFloat(takeProfitPct) : undefined,
        candleTime: latestCandle.openTime,
        provider,
        customNotes: customNotes.trim() || undefined,
      }),
    });

    // 2. Chart Vision (Canvas Screenshot Analysis)
    const visionPromise = imageBase64
      ? fetch('/api/ai/chart-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64,
            symbol,
            timeframe,
            lastCandleTime: latestCandle.openTime,
            forceRefresh: true,
          }),
        })
      : Promise.resolve(null);

    try {
      const [evalRes, visionRes] = await Promise.allSettled([evalPromise, visionPromise]);

      let hadSuccess = false;
      const errors: string[] = [];

      // Parse evaluator result
      if (evalRes.status === 'fulfilled') {
        const data = await evalRes.value.json();
        if (evalRes.value.ok && data.success) {
          setEvalResult(data.evaluation);
          hadSuccess = true;
        } else {
          errors.push(`Order Evaluator: ${data.error || `HTTP ${evalRes.value.status}`}`);
        }
      } else {
        errors.push(`Order Evaluator: ${evalRes.reason?.message || 'Request failed'}`);
      }

      // Parse vision result
      if (visionRes.status === 'fulfilled' && visionRes.value) {
        const data = await visionRes.value.json() as AnalyzeChartResponse & { error?: string };
        if (visionRes.value.ok && data.analysis) {
          setVisionResult(data);
          hadSuccess = true;
        } else {
          errors.push(`Chart Vision: ${data.error || `HTTP ${visionRes.value.status}`}`);
        }
      } else if (visionRes.status === 'rejected') {
        errors.push(`Chart Vision: ${visionRes.reason?.message || 'Request failed'}`);
      } else if (!imageBase64) {
        errors.push('Chart Vision: Chart canvas was not ready to capture.');
      }

      if (!hadSuccess && errors.length > 0) {
        setError(errors.join(' | '));
      } else if (errors.length > 0) {
        setPartialWarning(errors.join(' | '));
      }

      // Refetch history so new evaluation appears immediately
      fetchHistory(historyScope);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    latestCandle,
    getScreenshot,
    symbol,
    timeframe,
    direction,
    activeEntryPrice,
    stopLossPct,
    takeProfitPct,
    provider,
    customNotes,
    fetchHistory,
    historyScope,
  ]);

  // Load an item from history for inspection
  const loadHistoricalItem = (item: AiHistoryItem) => {
    setActiveHistoryItem(item);
    setEvalResult(item.evaluation);
    if (item.vision?.analysis) {
      setVisionResult({
        analysis: item.vision.analysis,
        fromCache: true,
        model: item.vision.model,
      });
    } else {
      setVisionResult(null);
    }
    setIsHistoryOpen(false);
  };

  const hasResults = Boolean(evalResult || visionResult);

  return (
    <div className="flex flex-col h-full bg-surface border-l border-surface-border text-xs overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-border bg-surface-2/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono font-bold text-accent text-[11px] tracking-wider uppercase">
            AI Trading Copilot
          </span>
          <span className="text-[10px] font-mono text-text-muted">
            {symbol} · {timeframe.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* History Button */}
          <button
            type="button"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px] transition-colors border ${
              isHistoryOpen
                ? 'bg-accent text-white border-accent'
                : 'bg-surface hover:bg-surface-3 text-text-muted hover:text-text-primary border-surface-border'
            }`}
            title="Browse past evaluations stored in database"
          >
            <span>📜</span>
            <span>History</span>
            {historyList.length > 0 && (
              <span className="bg-surface-3 text-text-primary px-1 py-0.2 rounded text-[9px] font-bold">
                {historyList.length}
              </span>
            )}
          </button>

          {currentPrice > 0 && (
            <span className="font-mono text-[11px] font-semibold text-text-price bg-surface px-1.5 py-0.5 rounded border border-surface-border">
              ${currentPrice.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: currentPrice < 1 ? 6 : 2,
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable Body ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3 scrollbar-thin">
        {/* ── HISTORY DRAWER / VIEW ────────────────────────────────────────── */}
        {isHistoryOpen && (
          <div className="p-3 rounded-lg border border-surface-border bg-surface-2 flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-surface-border/60 pb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs text-text-primary uppercase">
                  📜 Stored Evaluations History
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  ({historyList.length} runs)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="text-[11px] font-mono text-text-muted hover:text-text-primary"
              >
                ✕ Close
              </button>
            </div>

            {/* Scope Filter: Current vs All */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setHistoryScope('current');
                  fetchHistory('current');
                }}
                className={`flex-1 py-1 text-[10px] font-mono rounded transition-colors border ${
                  historyScope === 'current'
                    ? 'bg-accent/20 text-accent border-accent/40 font-bold'
                    : 'bg-surface text-text-muted border-surface-border hover:text-text-primary'
                }`}
              >
                {symbol} ({timeframe})
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryScope('all');
                  fetchHistory('all');
                }}
                className={`flex-1 py-1 text-[10px] font-mono rounded transition-colors border ${
                  historyScope === 'all'
                    ? 'bg-accent/20 text-accent border-accent/40 font-bold'
                    : 'bg-surface text-text-muted border-surface-border hover:text-text-primary'
                }`}
              >
                All Cryptos & Pairs
              </button>
            </div>

            {/* History List */}
            {isLoadingHistory ? (
              <div className="py-6 text-center text-text-muted font-mono text-[11px]">
                Loading evaluation history…
              </div>
            ) : historyError ? (
              <div className="py-4 px-3 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 font-mono text-[11px] leading-relaxed text-center flex flex-col items-center gap-1.5">
                <span className="font-bold">⚠️ {historyError}</span>
                <span className="text-[10px] text-text-muted">Start Docker / PostgreSQL to access past evaluations.</span>
                <button
                  type="button"
                  onClick={() => fetchHistory()}
                  className="mt-1 px-2.5 py-1 text-[10px] bg-surface-2 border border-surface-border rounded hover:border-accent text-text-primary transition-colors"
                >
                  ↻ Retry Connection
                </button>
              </div>
            ) : historyList.length === 0 ? (
              <div className="py-6 text-center text-text-muted font-mono text-[11px] leading-relaxed">
                No past evaluations recorded for this pair yet.
                <br />
                Run an analysis below to store it for future reference.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto scrollbar-thin pr-1">
                {historyList.map((item) => {
                  const within3d = isWithin3Days(item.createdAt);
                  const isCurrentActive = activeHistoryItem?.id === item.id;
                  const statusConf = STATUS_CONFIG[item.status];

                  return (
                    <div
                      key={item.id}
                      onClick={() => loadHistoricalItem(item)}
                      className={`p-2.5 rounded border cursor-pointer transition-all flex flex-col gap-1.5 ${
                        isCurrentActive
                          ? 'border-accent bg-accent/10 shadow-sm'
                          : 'border-surface-border bg-surface hover:border-accent/50 hover:bg-surface-3'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase border ${statusConf.bg} ${statusConf.text} ${statusConf.border}`}
                          >
                            {statusConf.icon} {item.status}
                          </span>
                          <span className="font-mono font-bold text-[10px] uppercase text-text-primary">
                            {item.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}
                          </span>
                          <span className="text-[10px] font-mono text-text-muted">
                            {item.symbol} · {item.timeframe}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {within3d ? (
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                              {formatTimeAgo(item.createdAt)}
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono text-text-muted bg-surface-2 px-1 py-0.2 rounded border border-surface-border">
                              {formatTimeAgo(item.createdAt)} (&gt;3d)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Summary preview */}
                      <p className="text-[10px] text-text-secondary leading-snug line-clamp-2">
                        {item.evaluation.summary}
                      </p>

                      <div className="flex items-center justify-between pt-1 border-t border-surface-border/40 text-[9px] font-mono text-text-muted">
                        <span>Model: {item.modelProvider}</span>
                        <span>Tech: {item.evaluation.metrics?.technicalScore ?? '—'}/100</span>
                        <span>Vision: {item.vision ? '✓ Saved' : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Active Historical Notice Banner ──────────────────────────────── */}
        {activeHistoryItem && hasResults && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-2 border border-accent/40 text-[10px] font-mono">
            <div className="flex items-center gap-1.5 text-accent">
              <span>📜</span>
              <span>
                Viewing {isWithin3Days(activeHistoryItem.createdAt) ? 'Latest' : 'Archived (>3d)'} Analysis ({formatTimeAgo(activeHistoryItem.createdAt)})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveHistoryItem(null);
                setEvalResult(null);
                setVisionResult(null);
                setIsSetupOpen(true);
              }}
              className="text-[10px] text-accent hover:underline font-bold"
            >
              + New Live Setup
            </button>
          </div>
        )}

        {/* Setup Configuration Form */}
        <div className="flex flex-col gap-2.5 p-3 rounded-lg border border-surface-border bg-surface-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted font-bold">
              Trade Setup & Execution Parameters
            </span>
            {hasResults && (
              <button
                type="button"
                onClick={() => setIsSetupOpen((prev) => !prev)}
                className="text-[10px] font-mono text-accent hover:underline"
              >
                {isSetupOpen ? '▲ Collapse Setup' : '▼ Edit Setup'}
              </button>
            )}
          </div>

          {isSetupOpen && (
            <>
              {/* Direction Selector */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDirection('long')}
                  className={`py-1.5 font-mono font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 ${
                    direction === 'long'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-sm'
                      : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  <span>🟢</span>
                  <span>LONG SETUP</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('short')}
                  className={`py-1.5 font-mono font-bold text-xs rounded transition-all flex items-center justify-center gap-1.5 ${
                    direction === 'short'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-sm'
                      : 'bg-surface border border-surface-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  <span>🔴</span>
                  <span>SHORT SETUP</span>
                </button>
              </div>

              {/* AI Engine Model Picker */}
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-mono text-text-muted uppercase flex-shrink-0">
                  AI Engine:
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as EvaluatorProvider)}
                  className="flex-1 bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="gemini">Google Gemini (3.8 Flash / 2.5)</option>
                  <option value="claude">Anthropic Claude (Opus 5.1 / 3.7)</option>
                  <option value="chatgpt">ChatGPT (GPT 5.1 / 6 / 4o)</option>
                  <option value="ensemble">Ensemble Consensus (All Configured)</option>
                </select>
              </div>

              {/* Numeric Inputs: Entry, SL, TP */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[9px] font-mono text-text-muted uppercase block mb-0.5">
                    Entry ($)
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder={currentPrice > 0 ? currentPrice.toString() : 'Current'}
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono text-text-muted uppercase block mb-0.5">
                    Stop Loss %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(e.target.value)}
                    className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[9px] font-mono text-text-muted uppercase block">
                      Take Profit %
                    </label>
                    {rrRatio && (
                      <span className="text-[8px] font-mono text-accent">
                        1:{rrRatio}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={takeProfitPct}
                    onChange={(e) => setTakeProfitPct(e.target.value)}
                    className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] font-mono text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Optional Custom Notes */}
              <input
                type="text"
                placeholder="Optional setup notes / macro context (e.g. 4h bounce, CPI print)..."
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                className="w-full bg-surface border border-surface-border rounded px-2 py-1 text-[11px] text-text-primary focus:outline-none focus:border-accent"
              />
            </>
          )}

          {/* Unified Primary Action CTA */}
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyze}
            className="w-full py-2.5 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-mono font-bold text-xs uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2 shadow-md active:scale-[0.99]"
          >
            {isAnalyzing ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>Evaluating Order & Chart Vision…</span>
              </>
            ) : hasResults ? (
              <>
                <span>↺</span>
                <span>Re-Analyze Order & Chart Vision</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>Run AI Decision & Chart Vision</span>
              </>
            )}
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-[11px] text-rose-400 font-mono">
            {error}
          </div>
        )}

        {/* Partial Warning Banner */}
        {partialWarning && (
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[10px] text-amber-400 font-mono">
            {partialWarning}
          </div>
        )}

        {/* ── Cohesive Results Section ───────────────────────────────────── */}
        {hasResults && !isAnalyzing && (
          <div className="flex flex-col gap-2.5">
            {/* 1. Gatekeeper Verdict Banner */}
            {evalResult && (
              <div
                className={`p-3 rounded-lg border flex flex-col gap-2 ${
                  STATUS_CONFIG[evalResult.status].bg
                } ${STATUS_CONFIG[evalResult.status].border}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {STATUS_CONFIG[evalResult.status].icon}
                    </span>
                    <div>
                      <span
                        className={`font-mono font-black text-sm tracking-wide ${
                          STATUS_CONFIG[evalResult.status].text
                        }`}
                      >
                        {STATUS_CONFIG[evalResult.status].label}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-mono text-text-muted">
                          Confidence: <b className="text-text-primary uppercase">{evalResult.confidence}</b>
                        </span>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-[10px] font-mono text-text-muted">
                          Setup: <b className="uppercase">{direction}</b> @ ${activeEntryPrice.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[9px] font-mono text-text-muted block">
                      {evalResult.model.modelName}
                    </span>
                    {activeHistoryItem ? (
                      <span className="text-[9px] font-mono uppercase bg-surface px-1.5 py-0.5 rounded text-accent border border-accent/20">
                        {formatTimeAgo(activeHistoryItem.createdAt)}
                      </span>
                    ) : evalResult.fromCache ? (
                      <span className="text-[9px] font-mono uppercase bg-surface px-1.5 py-0.5 rounded text-accent border border-accent/20">
                        Cached
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Core Executive Summary */}
                <div className="p-2 bg-surface/80 rounded border border-surface-border text-[11px] leading-relaxed text-text-primary">
                  {evalResult.summary}
                </div>
              </div>
            )}

            {/* 2. Visual Chart Analysis & Levels (Vision) */}
            {visionResult && (
              <>
                <VisualTrendCard analysis={visionResult.analysis} />
                <KeyLevelsTable levels={visionResult.analysis.key_levels} />
                <DetectedPatterns patterns={visionResult.analysis.patterns} />
              </>
            )}

            {/* 3. Confluence Breakdown: Technical & Sentiment (Evaluator) */}
            {evalResult && (
              <div className="flex flex-col gap-2">
                {/* Technical Alignment */}
                <div className="p-2.5 bg-surface rounded-lg border border-surface-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                      📊 Technical Indicators Alignment
                    </span>
                    <span className="text-[10px] font-mono font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
                      Score: {evalResult.metrics.technicalScore}/100
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.technical}
                  </p>
                </div>

                {/* News & Social Sentiment */}
                <div className="p-2.5 bg-surface rounded-lg border border-surface-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-text-muted">
                      📰 Multi-Channel Catalyst & News
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                        evalResult.metrics.sentimentScore > 0
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                          : evalResult.metrics.sentimentScore < 0
                          ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                          : 'text-text-muted bg-surface-2 border-surface-border'
                      }`}
                    >
                      Sentiment: {evalResult.metrics.sentimentScore > 0 ? '+' : ''}
                      {evalResult.metrics.sentimentScore}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.sentiment}
                  </p>
                </div>

                {/* Primary Risk & Invalidation */}
                <div className="p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                  <span className="text-[10px] font-mono uppercase font-bold text-amber-400 block mb-1">
                    ⚠️ Primary Invalidation & Risk Factors
                  </span>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {evalResult.reasons.primaryRisk}
                  </p>

                  {/* Append Vision risk notes if present */}
                  {visionResult?.analysis.risk_notes && visionResult.analysis.risk_notes.length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-amber-500/15 flex flex-col gap-1">
                      {visionResult.analysis.risk_notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-[10px] text-text-secondary">
                          <span className="text-amber-500 flex-shrink-0">▲</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Ensemble Model Breakdown (if applicable) */}
                {evalResult.model.ensembleVotes &&
                  Object.keys(evalResult.model.ensembleVotes).length > 0 && (
                    <div className="p-2.5 bg-surface rounded-lg border border-surface-border flex flex-col gap-1.5">
                      <span className="text-[10px] font-mono uppercase text-text-muted font-bold">
                        Ensemble Consensus Votes:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(evalResult.model.ensembleVotes).map(([modelKey, vote]) => (
                          <span
                            key={modelKey}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                              vote.status === 'PASS'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : vote.status === 'CAVEAT'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {modelKey}: {vote.status}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Disclaimer */}
            <div className="p-2 rounded bg-surface border border-surface-border text-[9px] text-text-muted leading-relaxed">
              {visionResult?.analysis.disclaimer ??
                'This automated AI analysis is for educational and decision-support purposes only and does not constitute financial advice. Always exercise proper risk management.'}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!hasResults && !isAnalyzing && !error && !isHistoryOpen && (
          <div className="flex flex-col items-center justify-center p-6 text-center rounded-lg border border-dashed border-surface-border bg-surface-2/30 my-auto">
            <span className="text-2xl mb-2">⚡</span>
            <h4 className="font-mono text-xs font-bold text-text-primary mb-1">
              Dual-Engine AI Copilot
            </h4>
            <p className="text-[11px] text-text-muted leading-relaxed max-w-[260px]">
              Combines live canvas Chart Vision (patterns, S/R levels) with 37+ indicators & news sentiment to give an actionable PASS/CAVEAT/REJECT verdict.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
